import { WasmPosixKernel } from "./kernel";
import type { KernelCallbacks } from "./kernel";
import type { PlatformIO } from "./types";
import type {
  WorkerInitMessage,
  WorkerToHostMessage,
  HostToWorkerMessage,
  RegisterPipeMessage,
  ConvertPipeMessage,
  ExecReplyMessage,
} from "./worker-protocol";
import { instantiateAndRunProgram } from "./program-runner";
import { SharedPipeBuffer } from "./shared-pipe-buffer";

export interface MessagePort {
  postMessage(msg: unknown, transferList?: unknown[]): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export type CreateIOFn = (initData: WorkerInitMessage) => PlatformIO;

export async function workerMain(
  port: MessagePort,
  initData: WorkerInitMessage,
  createIO: CreateIOFn,
): Promise<void> {
  try {
    const callbacks: KernelCallbacks = {
      onKill: (pid: number, signal: number): number => {
        port.postMessage({
          type: "kill_request",
          pid,
          signal,
          sourcePid: initData.pid,
        } satisfies WorkerToHostMessage);
        return 0; // fire-and-forget from kernel's perspective
      },
      onExec: (path: string): number => {
        port.postMessage({
          type: "exec_request",
          pid: initData.pid,
          path,
        } satisfies WorkerToHostMessage);
        return 0;
      },
      onAlarm: (seconds: number): number => {
        port.postMessage({
          type: "alarm_set",
          pid: initData.pid,
          seconds,
        } satisfies WorkerToHostMessage);
        return 0;
      },
      onWaitpid: (targetPid: number, options: number): void => {
        port.postMessage({
          type: "waitpid_request",
          pid: initData.pid,
          targetPid,
          options,
          waitpidSab: initData.waitpidSab!,
        } satisfies WorkerToHostMessage);
      },
      onFork: (forkSab: SharedArrayBuffer): void => {
        // Convert kernel-internal pipes to SharedPipeBuffers BEFORE serializing
        // fork state. This ensures both parent and child share the same pipe
        // buffers. We must do this before Atomics.wait because the parent can't
        // process messages while blocked.
        const inst = kernel.getInstance()!;
        const mem = kernel.getMemory()!;
        const pipeSabs: { handle: number; sab: SharedArrayBuffer; end: "read" | "write" }[] = [];
        try {
          const getPipeOfds = inst.exports.kernel_get_pipe_ofds as
            (ptr: number, len: number) => number;
          const PIPE_BUF_PAGES = 1;
          const pipeBufPage = mem.grow(PIPE_BUF_PAGES);
          const pipeBufPtr = pipeBufPage * 65536;
          const pipeBufSize = PIPE_BUF_PAGES * 65536;
          const pipeCount = getPipeOfds(pipeBufPtr, pipeBufSize);

          if (pipeCount > 0) {
            const convertFn = inst.exports.kernel_convert_pipe_to_host as
              (ofdIdx: number, newHandle: bigint) => number;
            const pipeView = new DataView(mem.buffer, pipeBufPtr, pipeCount * 16);

            // Group pipe OFDs by host_handle (same pipe has same |host_handle|)
            const groups = new Map<bigint, { ofdIndex: number; isRead: boolean }[]>();
            for (let i = 0; i < pipeCount; i++) {
              const ofdIndex = pipeView.getUint32(i * 16, true);
              const hostHandle = pipeView.getBigInt64(i * 16 + 4, true);
              const isRead = pipeView.getUint32(i * 16 + 12, true) === 1;
              // Already converted pipes have positive host_handle; skip them
              if (hostHandle >= 0) continue;
              const key = hostHandle < 0n ? -hostHandle : hostHandle;
              const existing = groups.get(key);
              if (existing) existing.push({ ofdIndex, isRead });
              else groups.set(key, [{ ofdIndex, isRead }]);
            }

            // Create SharedPipeBuffer per pipe group, convert OFDs
            let nextHandle = 1000; // Start pipe handles high to avoid conflicts
            for (const ofds of groups.values()) {
              const sharedPipe = SharedPipeBuffer.create();
              const sab = sharedPipe.getBuffer();
              for (const ofd of ofds) {
                const handle = nextHandle++;
                const end = ofd.isRead ? "read" as const : "write" as const;
                kernel.registerSharedPipe(handle, sab, end);
                convertFn(ofd.ofdIndex, BigInt(handle));
                pipeSabs.push({ handle, sab, end });
              }
            }
          }
        } catch {
          // If pipe enumeration fails, proceed without pipe conversion
        }

        // Serialize fork state NOW (after pipe conversion), before Atomics.wait.
        const FORK_BUF_PAGES = 16;
        const sp = mem.grow(FORK_BUF_PAGES);
        const bp = sp * 65536;
        const bs = FORK_BUF_PAGES * 65536;
        const getForkState = inst.exports.kernel_get_fork_state as
          (ptr: number, len: number) => number;
        const written = getForkState(bp, bs);
        const forkState = written > 0
          ? new Uint8Array(mem.buffer, bp, written).slice().buffer
          : new ArrayBuffer(0);
        port.postMessage({
          type: "fork_request",
          pid: initData.pid,
          forkSab,
          forkState,
          pipeSabs: pipeSabs.map(p => ({ handle: p.handle, sab: p.sab, end: p.end })),
        } satisfies WorkerToHostMessage,
        [forkState]);
      },
    };

    let kernel = new WasmPosixKernel(initData.kernelConfig, createIO(initData), callbacks);
    await kernel.init(initData.wasmBytes);

    let instance = kernel.getInstance()!;

    if (initData.signalWakeSab) {
      kernel.registerSignalWakeSab(initData.signalWakeSab);
    }

    if (initData.lockTableSab) {
      kernel.registerSharedLockTable(initData.lockTableSab);
    }

    if (initData.forkSab) {
      kernel.registerForkSab(initData.forkSab);
    }

    if (initData.waitpidSab) {
      kernel.registerWaitpidSab(initData.waitpidSab);
    }

    if (initData.forkState) {
      // Fork init: write fork state to Wasm memory and call kernel_init_from_fork
      const memory = kernel.getMemory()!;
      const forkBytes = new Uint8Array(initData.forkState);
      const pages = Math.ceil(forkBytes.byteLength / 65536) + 1;
      const startPage = memory.grow(pages);
      const bufPtr = startPage * 65536;
      new Uint8Array(memory.buffer, bufPtr, forkBytes.byteLength).set(forkBytes);

      const kernelInitFromFork = instance.exports.kernel_init_from_fork as
        (ptr: number, len: number, pid: number) => number;
      const result = kernelInitFromFork(bufPtr, forkBytes.byteLength, initData.pid);
      if (result < 0) {
        throw new Error(`kernel_init_from_fork failed with error ${result}`);
      }
    } else {
      // Fresh init
      const kernelInit = instance.exports.kernel_init as (pid: number) => void;
      kernelInit(initData.pid);
    }

    // Set environment variables and argv if provided
    const needsScratch = (initData.env && initData.env.length > 0)
      || (initData.argv && initData.argv.length > 0);
    let scratchPtr = 0;
    if (needsScratch) {
      const memory = kernel.getMemory()!;
      const scratchPage = memory.grow(1);
      scratchPtr = scratchPage * 65536;
    }
    const encoder = new TextEncoder();

    if (initData.env && initData.env.length > 0) {
      const setenv = instance.exports.kernel_setenv as
        (namePtr: number, nameLen: number, valPtr: number, valLen: number, overwrite: number) => number;
      const memory = kernel.getMemory()!;
      for (const entry of initData.env) {
        const eq = entry.indexOf("=");
        if (eq < 0) continue;
        const nameBytes = encoder.encode(entry.slice(0, eq));
        const valBytes = encoder.encode(entry.slice(eq + 1));
        const buf = new Uint8Array(memory.buffer);
        const valPtr = scratchPtr + nameBytes.length;
        buf.set(nameBytes, scratchPtr);
        buf.set(valBytes, valPtr);
        setenv(scratchPtr, nameBytes.length, valPtr, valBytes.length, 1);
      }
    }

    if (initData.argv && initData.argv.length > 0) {
      const pushArgv = instance.exports.kernel_push_argv as
        (ptr: number, len: number) => void;
      const memory = kernel.getMemory()!;
      for (const arg of initData.argv) {
        const bytes = encoder.encode(arg);
        const buf = new Uint8Array(memory.buffer);
        buf.set(bytes, scratchPtr);
        pushArgv(scratchPtr, bytes.length);
      }
    }

    port.postMessage({
      type: "ready",
      pid: initData.pid,
    } satisfies WorkerToHostMessage);

    // Check if this is a fork child with pending exec (posix_spawn pattern).
    // If so, apply fd_actions and send exec_request instead of running programBytes.
    let forkChildHandledExec = false;
    if (initData.forkState) {
      const isForkChild = instance.exports.kernel_is_fork_child as () => number;
      if (isForkChild() === 1) {
        const getExecPath = instance.exports.kernel_get_fork_exec_path as
          (ptr: number, len: number) => number;
        const memory = kernel.getMemory()!;
        const pathBufPage = memory.grow(1);
        const pathBufPtr = pathBufPage * 65536;
        const pathLen = getExecPath(pathBufPtr, 65536);
        if (pathLen > 0) {
          // Apply fd actions (dup2, close) before exec
          const applyFdActions = instance.exports.kernel_apply_fork_fd_actions as () => number;
          applyFdActions();

          // Set argv from fork_exec_argv so exec state captures the right argv
          const getArgc = instance.exports.kernel_get_fork_exec_argc as () => number;
          const getArgv = instance.exports.kernel_get_fork_exec_argv as
            (idx: number, ptr: number, len: number) => number;
          const clearArgv = instance.exports.kernel_clear_argv as () => void;
          const pushArgv = instance.exports.kernel_push_argv as
            (ptr: number, len: number) => void;
          const argc = getArgc();
          if (argc > 0) {
            clearArgv();
            for (let i = 0; i < argc; i++) {
              const argLen = getArgv(i, pathBufPtr, 65536);
              if (argLen > 0) {
                pushArgv(pathBufPtr, argLen);
              }
            }
          }

          // Read exec path
          // Re-read since getArgv may have overwritten pathBufPtr
          const pathLen2 = getExecPath(pathBufPtr, 65536);
          const pathBytes = new Uint8Array(memory.buffer, pathBufPtr, pathLen2);
          const execPath = new TextDecoder().decode(pathBytes);

          // Send exec_request to host — exec_reply handler will start the new program
          port.postMessage({
            type: "exec_request",
            pid: initData.pid,
            path: execPath,
          } satisfies WorkerToHostMessage);
          forkChildHandledExec = true;
        }
      }
    }

    // If programBytes provided and not already handling fork+exec,
    // run the user program after signaling ready.
    // This runs asynchronously so the message listener below can handle
    // incoming messages (fork_request responses, signals, etc.) while
    // the program executes.
    if (initData.programBytes && !forkChildHandledExec) {
      (async () => {
        try {
          const exitCode = await instantiateAndRunProgram(kernel, initData.programBytes!);
          port.postMessage({
            type: "exit",
            pid: initData.pid,
            status: exitCode,
          } satisfies WorkerToHostMessage);
        } catch (err) {
          port.postMessage({
            type: "error",
            pid: initData.pid,
            message: `Program failed: ${err instanceof Error ? err.message : String(err)}`,
          } satisfies WorkerToHostMessage);
        }
      })();
    }

    // Listen for messages from host
    port.on("message", (msg: unknown) => {
      const m = msg as HostToWorkerMessage;
      switch (m.type) {
        case "terminate":
          port.postMessage({
            type: "exit",
            pid: initData.pid,
            status: 0,
          } satisfies WorkerToHostMessage);
          break;
        case "get_fork_state": {
          const memory = kernel.getMemory()!;
          const FORK_BUF_PAGES = 16; // 1MB buffer
          const startPage = memory.grow(FORK_BUF_PAGES);
          const bufPtr = startPage * 65536;
          const bufSize = FORK_BUF_PAGES * 65536;

          const kernelGetForkState = instance.exports.kernel_get_fork_state as
            (ptr: number, len: number) => number;
          const written = kernelGetForkState(bufPtr, bufSize);
          if (written < 0) {
            port.postMessage({
              type: "error",
              pid: initData.pid,
              message: `kernel_get_fork_state failed: ${written}`,
            } satisfies WorkerToHostMessage);
            break;
          }

          const forkData = new Uint8Array(memory.buffer, bufPtr, written).slice();
          port.postMessage(
            { type: "fork_state", pid: initData.pid, data: forkData.buffer } satisfies WorkerToHostMessage,
            [forkData.buffer],
          );
          break;
        }
        case "register_pipe": {
          const msg = m as RegisterPipeMessage;
          kernel.registerSharedPipe(msg.handle, msg.buffer, msg.end);
          break;
        }
        case "convert_pipe": {
          const msg = m as ConvertPipeMessage;
          const convertFn = instance.exports.kernel_convert_pipe_to_host as
            (ofdIdx: number, newHandle: bigint) => number;
          const result = convertFn(msg.ofdIndex, BigInt(msg.newHandle));
          if (result < 0) {
            port.postMessage({
              type: "error",
              pid: initData.pid,
              message: `kernel_convert_pipe_to_host failed: ${result}`,
            } satisfies WorkerToHostMessage);
          }
          break;
        }
        case "deliver_signal": {
          const deliverFn = instance.exports.kernel_deliver_signal as
            (sig: number) => number;
          deliverFn(m.signal);
          break;
        }
        case "exec_reply": {
          (async () => {
            try {
              const msg = m as ExecReplyMessage;
              // 1. Get exec state from current kernel
              const memory = kernel.getMemory()!;
              const EXEC_BUF_PAGES = 16; // 1MB buffer
              const startPage = memory.grow(EXEC_BUF_PAGES);
              const bufPtr = startPage * 65536;
              const bufSize = EXEC_BUF_PAGES * 65536;

              const getExecState = instance.exports.kernel_get_exec_state as
                (ptr: number, len: number) => number;
              const written = getExecState(bufPtr, bufSize);
              if (written < 0) {
                port.postMessage({
                  type: "error",
                  pid: initData.pid,
                  message: `kernel_get_exec_state failed: ${written}`,
                } satisfies WorkerToHostMessage);
                return;
              }
              const execState = new Uint8Array(memory.buffer, bufPtr, written).slice();

              // 2. Create new kernel with new binary
              const newKernel = new WasmPosixKernel(initData.kernelConfig, createIO(initData), callbacks);
              await newKernel.init(msg.wasmBytes);
              const newInstance = newKernel.getInstance()!;
              const newMemory = newKernel.getMemory()!;

              // 3. Write exec state to new kernel memory and init
              const pages = Math.ceil(execState.byteLength / 65536) + 1;
              const sp = newMemory.grow(pages);
              const bp = sp * 65536;
              new Uint8Array(newMemory.buffer, bp, execState.byteLength).set(execState);

              const initFromExec = newInstance.exports.kernel_init_from_exec as
                (ptr: number, len: number, pid: number) => number;
              const result = initFromExec(bp, execState.byteLength, initData.pid);
              if (result < 0) {
                port.postMessage({
                  type: "error",
                  pid: initData.pid,
                  message: `kernel_init_from_exec failed: ${result}`,
                } satisfies WorkerToHostMessage);
                return;
              }

              // 4. Transfer shared pipe registrations from old kernel
              for (const [handle, entry] of kernel.getSharedPipes()) {
                newKernel.registerSharedPipe(handle, entry.pipe.getBuffer(), entry.end);
              }

              // Transfer signal wake SAB to new kernel
              if (initData.signalWakeSab) {
                newKernel.registerSignalWakeSab(initData.signalWakeSab);
              }

              // Transfer lock table SAB to new kernel
              if (initData.lockTableSab) {
                newKernel.registerSharedLockTable(initData.lockTableSab);
              }

              // Transfer fork SAB to new kernel
              if (initData.forkSab) {
                newKernel.registerForkSab(initData.forkSab);
              }

              // Transfer waitpid SAB to new kernel
              if (initData.waitpidSab) {
                newKernel.registerWaitpidSab(initData.waitpidSab);
              }

              // 5. Replace references
              kernel = newKernel;
              instance = newInstance;

              // 6. Notify host
              port.postMessage({
                type: "exec_complete",
                pid: initData.pid,
              } satisfies WorkerToHostMessage);

              // 7. If exec_reply includes programBytes, run the new program
              if (msg.programBytes) {
                const exitCode = await instantiateAndRunProgram(kernel, msg.programBytes);
                port.postMessage({
                  type: "exit",
                  pid: initData.pid,
                  status: exitCode,
                } satisfies WorkerToHostMessage);
              }
            } catch (err) {
              port.postMessage({
                type: "error",
                pid: initData.pid,
                message: `exec failed: ${err instanceof Error ? err.message : String(err)}`,
              } satisfies WorkerToHostMessage);
            }
          })();
          break;
        }
      }
    });
  } catch (err) {
    port.postMessage({
      type: "error",
      pid: initData.pid,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerToHostMessage);
  }
}

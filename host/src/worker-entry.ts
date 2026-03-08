// host/src/worker-entry.ts
import { parentPort, workerData } from "node:worker_threads";
import { WasmPosixKernel } from "./kernel";
import { NodePlatformIO } from "./platform/node";
import type {
  WorkerInitMessage,
  WorkerToHostMessage,
  HostToWorkerMessage,
} from "./worker-protocol";

interface MessagePort {
  postMessage(msg: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export async function workerMain(
  port: MessagePort,
  initData: WorkerInitMessage,
): Promise<void> {
  try {
    const kernel = new WasmPosixKernel(initData.kernelConfig, new NodePlatformIO());
    await kernel.init(initData.wasmBytes);

    const instance = kernel.getInstance()!;
    const kernelInit = instance.exports.kernel_init as (pid: number) => void;
    kernelInit(initData.pid);

    port.postMessage({
      type: "ready",
      pid: initData.pid,
    } satisfies WorkerToHostMessage);

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

// When running as an actual worker thread
if (parentPort) {
  workerMain(parentPort, workerData as WorkerInitMessage);
}

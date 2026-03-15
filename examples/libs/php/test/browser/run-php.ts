/**
 * Browser test harness — runs PHP CLI via wasm-posix-kernel using
 * VirtualPlatformIO + MemoryFileSystem (the browser code path).
 */

import { WasmPosixKernel, type KernelCallbacks } from "../../../../../host/src/kernel";
import { ProgramRunner } from "../../../../../host/src/program-runner";
import { VirtualPlatformIO } from "../../../../../host/src/vfs/vfs";
import { MemoryFileSystem } from "../../../../../host/src/vfs/memory-fs";
import { DeviceFileSystem } from "../../../../../host/src/vfs/device-fs";
import { BrowserTimeProvider } from "../../../../../host/src/vfs/time";
import kernelWasmUrl from "../../../../../host/wasm/wasm_posix_kernel.wasm?url";

const stdoutEl = document.getElementById("stdout")!;
const stderrEl = document.getElementById("stderr")!;
const exitCodeEl = document.getElementById("exit-code")!;
const statusEl = document.getElementById("status")!;

async function main() {
  try {
    const [kernelBytes, phpBytes] = await Promise.all([
      fetch(kernelWasmUrl).then((r) => r.arrayBuffer()),
      fetch("/php.wasm").then((r) => r.arrayBuffer()),
    ]);

    // Set up virtual filesystem (browser path — no Node.js fs)
    const memfs = MemoryFileSystem.create(new SharedArrayBuffer(16 * 1024 * 1024));
    const devfs = new DeviceFileSystem();
    memfs.mkdir("/tmp", 0o777);
    memfs.mkdir("/home", 0o755);
    memfs.mkdir("/dev", 0o755);

    const io = new VirtualPlatformIO(
      [
        { mountPoint: "/dev", backend: devfs },
        { mountPoint: "/", backend: memfs },
      ],
      new BrowserTimeProvider(),
    );

    const decoder = new TextDecoder();
    const callbacks: KernelCallbacks = {
      onStdout: (data) => { stdoutEl.textContent += decoder.decode(data); },
      onStderr: (data) => { stderrEl.textContent += decoder.decode(data); },
    };

    const kernel = new WasmPosixKernel(
      { maxWorkers: 1, dataBufferSize: 65536, useSharedMemory: true },
      io,
      callbacks,
    );

    await kernel.init(kernelBytes);

    const runner = new ProgramRunner(kernel);
    const exitCode = await runner.run(phpBytes, {
      argv: ["php", "-r", 'echo "Hello World\n";'],
      env: [
        "HOME=/home",
        "TMPDIR=/tmp",
        "TERM=xterm-256color",
      ],
    });

    exitCodeEl.textContent = String(exitCode);
    statusEl.textContent = "done";
  } catch (e) {
    stderrEl.textContent += String(e);
    statusEl.textContent = "error";
  }
}

main();

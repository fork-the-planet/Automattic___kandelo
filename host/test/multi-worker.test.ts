// host/test/multi-worker.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessManager } from "../src/process-manager";
import { NodeWorkerAdapter } from "../src/worker-adapter";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadWasmBytes(): ArrayBuffer {
  const wasmPath = join(__dirname, "../wasm/wasm_posix_kernel.wasm");
  const buf = readFileSync(wasmPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("Multi-Worker Integration", () => {
  it("should spawn PID 1 in a real worker thread", async () => {
    const pm = new ProcessManager({
      wasmBytes: loadWasmBytes(),
      kernelConfig: {
        maxWorkers: 4,
        dataBufferSize: 65536,
        useSharedMemory: false,
      },
      workerAdapter: new NodeWorkerAdapter(),
    });

    const pid = await pm.spawn();
    expect(pid).toBe(1);

    const info = pm.getProcess(1);
    expect(info).toBeDefined();
    expect(info!.state).toBe("running");

    await pm.terminate(1);
  }, 15_000);

  it("should spawn multiple processes in separate workers", async () => {
    const pm = new ProcessManager({
      wasmBytes: loadWasmBytes(),
      kernelConfig: {
        maxWorkers: 4,
        dataBufferSize: 65536,
        useSharedMemory: false,
      },
      workerAdapter: new NodeWorkerAdapter(),
    });

    const pid1 = await pm.spawn();
    const pid2 = await pm.spawn();

    expect(pid1).toBe(1);
    expect(pid2).toBe(2);
    expect(pm.getProcessCount()).toBe(2);

    await pm.terminate(1);
    await pm.terminate(2);
  }, 15_000);
});

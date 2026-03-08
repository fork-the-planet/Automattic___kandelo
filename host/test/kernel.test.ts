import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WasmPosixKernel } from "../src/kernel";
import { NodePlatformIO } from "../src/platform/node";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("WasmPosixKernel", () => {
  it("should initialize the kernel from wasm bytes", async () => {
    const wasmPath = join(__dirname, "../wasm/wasm_posix_kernel.wasm");
    const wasmBytes = readFileSync(wasmPath);

    const kernel = new WasmPosixKernel(
      { maxWorkers: 4, dataBufferSize: 65536, useSharedMemory: false },
      new NodePlatformIO(),
    );

    await kernel.init(wasmBytes);
    // If init doesn't throw, the kernel loaded and wasm start function ran

    // Verify the instance and memory are available
    expect(kernel.getInstance()).not.toBeNull();
    expect(kernel.getMemory()).not.toBeNull();

    // Call kernel_init to set up the process
    const instance = kernel.getInstance()!;
    const kernelInit = instance.exports.kernel_init as (pid: number) => void;
    kernelInit(1);

    // Verify we can call an exported function without crashing.
    // kernel_dup on an invalid fd should return a negative errno.
    const kernelDup = instance.exports.kernel_dup as (fd: number) => number;
    const result = kernelDup(99);
    expect(result).toBeLessThan(0); // EBADF
  });
});

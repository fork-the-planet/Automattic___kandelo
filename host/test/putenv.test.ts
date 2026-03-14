import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WasmPosixKernel } from "../src/kernel";
import { ProgramRunner } from "../src/program-runner";
import { NodePlatformIO } from "../src/platform/node";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("putenv / setenv / unsetenv", () => {
  async function runPutenvTest(): Promise<{ exitCode: number; stdout: string }> {
    const kernelWasm = readFileSync(join(__dirname, "../wasm/wasm_posix_kernel.wasm"));
    const programWasm = readFileSync(join(__dirname, "../../examples/putenv_test.wasm"));

    let stdout = "";
    const io = new NodePlatformIO();

    const kernel = new WasmPosixKernel(
      { maxWorkers: 1, dataBufferSize: 65536, useSharedMemory: false },
      io,
      {
        onStdout: (data: Uint8Array) => {
          stdout += new TextDecoder().decode(data);
        },
      },
    );
    await kernel.init(kernelWasm);

    const runner = new ProgramRunner(kernel);
    const exitCode = await runner.run(programWasm, {
      env: ["HOME=/home/test", "PATH=/usr/bin"],
    });
    return { exitCode, stdout };
  }

  it("populates __environ from kernel at startup and syncs setenv/putenv/unsetenv", async () => {
    const { exitCode, stdout } = await runPutenvTest();

    // Startup env population from kernel
    expect(stdout).toContain("HOME=/home/test");
    expect(stdout).toContain("PATH=/usr/bin");

    // setenv
    expect(stdout).toContain("MY_VAR=hello");

    // setenv overwrite
    expect(stdout).toMatch(/MY_VAR=world/);

    // setenv no-overwrite (should still be "world")
    const myVarLines = stdout.split("\n").filter(l => l.startsWith("MY_VAR="));
    expect(myVarLines[0]).toBe("MY_VAR=hello");
    expect(myVarLines[1]).toBe("MY_VAR=world");
    expect(myVarLines[2]).toBe("MY_VAR=world");

    // putenv
    expect(stdout).toContain("PUT_VAR=from_putenv");

    // unsetenv
    expect(stdout).toContain("MY_VAR=<not set>");

    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);
  }, 30_000);
});

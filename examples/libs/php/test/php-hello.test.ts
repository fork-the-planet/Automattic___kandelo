import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WasmPosixKernel } from "../../../../host/src/kernel";
import { ProgramRunner } from "../../../../host/src/program-runner";
import { NodePlatformIO } from "../../../../host/src/platform/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");

const kernelWasm = readFileSync(join(repoRoot, "host/wasm/wasm_posix_kernel.wasm"));
const phpWasm = readFileSync(join(__dirname, "../php-src/sapi/cli/php"));

describe("PHP CLI on wasm-posix-kernel", () => {
    it("runs 'echo Hello World' via php -r", async () => {
        let stdout = "";
        let stderr = "";
        const io = new NodePlatformIO();

        const kernel = new WasmPosixKernel(
            { maxWorkers: 1, dataBufferSize: 65536, useSharedMemory: false },
            io,
            {
                onStdout: (data: Uint8Array) => {
                    stdout += new TextDecoder().decode(data);
                },
                onStderr: (data: Uint8Array) => {
                    stderr += new TextDecoder().decode(data);
                },
            },
        );

        await kernel.init(kernelWasm);

        const runner = new ProgramRunner(kernel);
        const exitCode = await runner.run(phpWasm, {
            argv: ["php", "-r", 'echo "Hello World\n";'],
        });

        if (exitCode !== 0) {
            console.log("STDOUT:", stdout);
            console.log("STDERR:", stderr);
        }

        expect(stdout).toContain("Hello World");
        expect(exitCode).toBe(0);
    }, 60_000);
});

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WasmPosixKernel } from "../../../../host/src/kernel";
import { ProgramRunner } from "../../../../host/src/program-runner";
import { NodePlatformIO } from "../../../../host/src/platform/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");

const kernelWasm = readFileSync(join(repoRoot, "host/wasm/wasm_posix_kernel.wasm"));
const phpWasm = readFileSync(join(__dirname, "../php-src/sapi/cli/php"));

async function runPhp(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
    const exitCode = await runner.run(phpWasm, { argv });

    if (exitCode !== 0) {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
    }

    return { stdout, stderr, exitCode };
}

describe("PHP CLI on wasm-posix-kernel", () => {
    it("runs 'echo Hello World' via php -r", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo "Hello World\n";']);
        expect(stdout).toContain("Hello World");
        expect(exitCode).toBe(0);
    }, 60_000);

    const tmpDir = join(__dirname, ".tmp");

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("runs a PHP script from a file", async () => {
        mkdirSync(tmpDir, { recursive: true });
        const scriptPath = join(tmpDir, "test.php");
        writeFileSync(scriptPath, '<?php echo "File Script OK\\n"; ?>');

        const { stdout, exitCode } = await runPhp(["php", scriptPath]);
        expect(stdout).toContain("File Script OK");
        expect(exitCode).toBe(0);
    }, 60_000);
});

describe("PHP extensions on wasm-posix-kernel", () => {
    it("mbstring works", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo mb_strlen("hello");']);
        expect(stdout).toContain("5");
        expect(exitCode).toBe(0);
    }, 60_000);

    it("ctype works", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo ctype_alpha("hello") ? "yes" : "no";']);
        expect(stdout).toContain("yes");
        expect(exitCode).toBe(0);
    }, 60_000);

    it("tokenizer works", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo count(token_get_all("<?php echo 1; ?>"));']);
        expect(stdout).toMatch(/\d+/);
        expect(exitCode).toBe(0);
    }, 60_000);

    it("filter works", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo filter_var("test@example.com", FILTER_VALIDATE_EMAIL);']);
        expect(stdout).toContain("test@example.com");
        expect(exitCode).toBe(0);
    }, 60_000);

    it("json works", async () => {
        const { stdout, exitCode } = await runPhp(["php", "-r", 'echo json_encode(["a" => 1]);']);
        expect(stdout).toContain('{"a":1}');
        expect(exitCode).toBe(0);
    }, 60_000);
});

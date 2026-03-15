/**
 * Browser test harness — runs PHP CLI via wasm-posix-kernel using
 * VirtualPlatformIO + MemoryFileSystem (the browser code path).
 *
 * Runs multiple PHP tests sequentially and reports results per-test.
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

const O_WRONLY = 1;
const O_CREAT = 0x40;

interface TestResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runPhp(
  phpBytes: ArrayBuffer,
  kernelBytes: ArrayBuffer,
  memfs: MemoryFileSystem,
  devfs: DeviceFileSystem,
  argv: string[],
): Promise<TestResult> {
  let stdout = "";
  let stderr = "";
  const decoder = new TextDecoder();

  const io = new VirtualPlatformIO(
    [
      { mountPoint: "/dev", backend: devfs },
      { mountPoint: "/", backend: memfs },
    ],
    new BrowserTimeProvider(),
  );

  const callbacks: KernelCallbacks = {
    onStdout: (data) => { stdout += decoder.decode(data); },
    onStderr: (data) => { stderr += decoder.decode(data); },
  };

  const kernel = new WasmPosixKernel(
    { maxWorkers: 1, dataBufferSize: 65536, useSharedMemory: true },
    io,
    callbacks,
  );

  await kernel.init(kernelBytes);

  const runner = new ProgramRunner(kernel);
  const exitCode = await runner.run(phpBytes, {
    argv,
    env: [
      "HOME=/home",
      "TMPDIR=/tmp",
      "TERM=xterm-256color",
    ],
  });

  return { stdout, stderr, exitCode };
}

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

    // Write a PHP script to the virtual filesystem
    const scriptContent = new TextEncoder().encode('<?php echo "Browser File OK\\n"; ?>');
    const fd = memfs.open("/home/script.php", O_WRONLY | O_CREAT, 0o644);
    memfs.write(fd, scriptContent, null, scriptContent.length);
    memfs.close(fd);

    // Write an extensions test script
    const extScript = new TextEncoder().encode(
      '<?php echo json_encode(["mb" => mb_strlen("hello"), "ctype" => ctype_alpha("hello") ? "yes" : "no"]); ?>'
    );
    const fd2 = memfs.open("/home/ext_test.php", O_WRONLY | O_CREAT, 0o644);
    memfs.write(fd2, extScript, null, extScript.length);
    memfs.close(fd2);

    // Test 1: php -r (inline)
    const r1 = await runPhp(phpBytes, kernelBytes, memfs, devfs,
      ["php", "-r", 'echo "Hello World\n";']);

    // Test 2: php script.php (file-based)
    const r2 = await runPhp(phpBytes, kernelBytes, memfs, devfs,
      ["php", "/home/script.php"]);

    // Test 3: extensions test
    const r3 = await runPhp(phpBytes, kernelBytes, memfs, devfs,
      ["php", "/home/ext_test.php"]);

    // Report all results
    stdoutEl.textContent = JSON.stringify({
      inline: r1.stdout,
      file: r2.stdout,
      extensions: r3.stdout,
    });
    stderrEl.textContent = [r1.stderr, r2.stderr, r3.stderr].filter(Boolean).join("\n---\n");
    exitCodeEl.textContent = String(Math.max(r1.exitCode, r2.exitCode, r3.exitCode));
    statusEl.textContent = "done";
  } catch (e) {
    stderrEl.textContent += String(e);
    statusEl.textContent = "error";
  }
}

main();

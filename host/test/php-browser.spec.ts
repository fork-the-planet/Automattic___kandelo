/**
 * Playwright test — runs PHP CLI in a real Chromium browser via wasm-posix-kernel.
 *
 * This verifies the browser code path: VirtualPlatformIO + MemoryFileSystem +
 * BrowserTimeProvider + SharedArrayBuffer, which differs significantly from the
 * Node.js path tested in examples/libs/php/test/php-hello.test.ts.
 *
 * The browser harness runs multiple PHP tests (inline, file-based, extensions)
 * and reports all results as JSON in the #stdout element.
 *
 * Run: cd host && npx playwright test
 */

import { test, expect } from "@playwright/test";

test("PHP CLI runs in the browser (inline, file, extensions)", async ({ page }) => {
  await page.goto("/");

  // Wait for all tests to finish (up to 120s — three sequential PHP runs)
  await page.waitForFunction(
    () => {
      const status = document.getElementById("status");
      return status && (status.textContent === "done" || status.textContent === "error");
    },
    { timeout: 120_000 },
  );

  const status = await page.locator("#status").textContent();
  const stdoutRaw = await page.locator("#stdout").textContent();
  const stderr = await page.locator("#stderr").textContent();
  const exitCode = await page.locator("#exit-code").textContent();

  if (status === "error" || exitCode !== "0") {
    console.log("STDOUT:", stdoutRaw);
    console.log("STDERR:", stderr);
    console.log("EXIT CODE:", exitCode);
  }

  expect(status).toBe("done");
  expect(exitCode).toBe("0");

  const results = JSON.parse(stdoutRaw!);

  // Test 1: inline php -r
  expect(results.inline).toContain("Hello World");

  // Test 2: file-based execution
  expect(results.file).toContain("Browser File OK");

  // Test 3: extensions (json_encode + mb_strlen)
  const extData = JSON.parse(results.extensions);
  expect(extData.mb).toBe(5);
  expect(extData.ctype).toBe("yes");
});

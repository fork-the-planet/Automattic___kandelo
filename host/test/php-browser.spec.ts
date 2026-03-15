/**
 * Playwright test — runs PHP CLI in a real Chromium browser via wasm-posix-kernel.
 *
 * This verifies the browser code path: VirtualPlatformIO + MemoryFileSystem +
 * BrowserTimeProvider + SharedArrayBuffer, which differs significantly from the
 * Node.js path tested in examples/libs/php/test/php-hello.test.ts.
 *
 * Run: cd host && npx playwright test
 */

import { test, expect } from "@playwright/test";

test("PHP CLI runs 'echo Hello World' in the browser", async ({ page }) => {
  await page.goto("/");

  // Wait for the test harness to finish (up to 60s for PHP startup)
  await page.waitForFunction(
    () => {
      const status = document.getElementById("status");
      return status && (status.textContent === "done" || status.textContent === "error");
    },
    { timeout: 60_000 },
  );

  const status = await page.locator("#status").textContent();
  const stdout = await page.locator("#stdout").textContent();
  const stderr = await page.locator("#stderr").textContent();
  const exitCode = await page.locator("#exit-code").textContent();

  if (status === "error" || exitCode !== "0") {
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
    console.log("EXIT CODE:", exitCode);
  }

  expect(status).toBe("done");
  expect(stdout).toContain("Hello World");
  expect(exitCode).toBe("0");
});

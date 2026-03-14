#!/usr/bin/env -S node --experimental-strip-types
import { resolveToolchain } from '../lib/toolchain.ts';
import { runPassthrough } from '../lib/exec.ts';

async function main(): Promise<void> {
  const toolchain = await resolveToolchain();
  const exitCode = await runPassthrough(toolchain.ar, process.argv.slice(2));
  process.exit(exitCode);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) main();

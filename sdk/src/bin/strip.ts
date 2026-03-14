#!/usr/bin/env -S node --experimental-strip-types

// strip is a no-op for Wasm targets.
// Wasm stripping is handled by the linker and wasm-opt.
process.exit(0);

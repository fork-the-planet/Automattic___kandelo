#!/bin/bash
set -euo pipefail

echo "Building Rust Wasm crates..."
cargo build --release \
  -Z build-std=core,alloc \
  -Z build-std-features=panic_immediate_abort

echo "Copying Wasm artifacts..."
mkdir -p host/wasm
cp target/wasm32-unknown-unknown/release/wasm_posix_kernel.wasm host/wasm/
cp target/wasm32-unknown-unknown/release/wasm_posix_userspace.wasm host/wasm/

echo "Building TypeScript host..."
cd host
npm run build
cd ..

echo "Build complete."

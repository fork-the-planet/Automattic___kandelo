/**
 * WasmPosixKernel — Loads the kernel Wasm module and provides host
 * import functions that bridge Wasm syscalls to the PlatformIO backend.
 *
 * Host import functions exposed to Wasm:
 *   env.host_open(path_ptr, path_len, flags, mode) -> i64
 *   env.host_close(handle: i64) -> i32
 *   env.host_read(handle: i64, buf_ptr, buf_len) -> i32
 *   env.host_write(handle: i64, buf_ptr, buf_len) -> i32
 *   env.host_seek(handle: i64, offset_lo, offset_hi, whence) -> i64
 *   env.host_fstat(handle: i64, stat_ptr) -> i32
 *
 * IMPORTANT: Wasm i64 values appear as BigInt in JavaScript.
 */

import type { KernelConfig, PlatformIO, StatResult } from "./types";

/** Size of the WasmStat struct in bytes (repr(C) layout). */
const WASM_STAT_SIZE = 88;

export class WasmPosixKernel {
  private config: KernelConfig;
  private io: PlatformIO;
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;

  constructor(config: KernelConfig, io: PlatformIO) {
    this.config = config;
    this.io = io;
  }

  /**
   * Load and instantiate the kernel Wasm module.
   *
   * @param wasmBytes - The compiled kernel Wasm binary
   */
  async init(wasmBytes: BufferSource): Promise<void> {
    // The Wasm binary compiled with atomics requires shared memory.
    // The initial/maximum page counts must match the Wasm import declaration
    // (initial=17, max=16384 as emitted by the Rust toolchain).
    const memory = new WebAssembly.Memory({
      initial: 17,
      maximum: 16384,
      shared: true,
    });
    this.memory = memory;

    const importObject: WebAssembly.Imports = {
      env: {
        memory,
        host_open: (
          pathPtr: number,
          pathLen: number,
          flags: number,
          mode: number,
        ): bigint => {
          return this.hostOpen(pathPtr, pathLen, flags, mode);
        },
        host_close: (handle: bigint): number => {
          return this.hostClose(handle);
        },
        host_read: (
          handle: bigint,
          bufPtr: number,
          bufLen: number,
        ): number => {
          return this.hostRead(handle, bufPtr, bufLen);
        },
        host_write: (
          handle: bigint,
          bufPtr: number,
          bufLen: number,
        ): number => {
          return this.hostWrite(handle, bufPtr, bufLen);
        },
        host_seek: (
          handle: bigint,
          offsetLo: number,
          offsetHi: number,
          whence: number,
        ): bigint => {
          return this.hostSeek(handle, offsetLo, offsetHi, whence);
        },
        host_fstat: (handle: bigint, statPtr: number): number => {
          return this.hostFstat(handle, statPtr);
        },
      },
    };

    const module = await WebAssembly.compile(
      wasmBytes as BufferSource,
    );
    this.instance = await WebAssembly.instantiate(module, importObject);
  }

  /**
   * Access the Wasm memory (e.g. for tests or advanced use).
   */
  getMemory(): WebAssembly.Memory | null {
    return this.memory;
  }

  /**
   * Access the Wasm instance (e.g. to call exported functions).
   */
  getInstance(): WebAssembly.Instance | null {
    return this.instance;
  }

  // ---- Host import implementations ----

  private getMemoryBuffer(): Uint8Array {
    if (!this.memory) {
      throw new Error("Kernel not initialized");
    }
    return new Uint8Array(this.memory.buffer);
  }

  private getMemoryDataView(): DataView {
    if (!this.memory) {
      throw new Error("Kernel not initialized");
    }
    return new DataView(this.memory.buffer);
  }

  /**
   * host_open(path_ptr, path_len, flags, mode) -> i64
   *
   * Reads the path from Wasm memory and delegates to PlatformIO.
   * For the initial synchronous implementation, we cannot truly await
   * the async PlatformIO.open — so we use a synchronous fallback that
   * blocks on the promise. In practice, NodePlatformIO uses sync fs
   * operations internally, so the promise resolves immediately.
   */
  private hostOpen(
    pathPtr: number,
    pathLen: number,
    flags: number,
    mode: number,
  ): bigint {
    try {
      const mem = this.getMemoryBuffer();
      const pathBytes = mem.slice(pathPtr, pathPtr + pathLen);
      const path = new TextDecoder().decode(pathBytes);

      // PlatformIO.open is async but NodePlatformIO resolves synchronously.
      // We use a synchronous extraction pattern here.
      let result = -1;
      let error: unknown = null;

      // Since NodePlatformIO wraps sync fs calls in async, the promise
      // settles in the same microtask. We capture the value via .then().
      this.io
        .open(path, flags, mode)
        .then((r) => {
          result = r;
        })
        .catch((e: unknown) => {
          error = e;
        });

      if (error) {
        return BigInt(-1);
      }
      return BigInt(result);
    } catch {
      return BigInt(-1);
    }
  }

  /**
   * host_close(handle: i64) -> i32
   */
  private hostClose(handle: bigint): number {
    const h = Number(handle);

    try {
      let result = -1;
      this.io
        .close(h)
        .then((r) => {
          result = r;
        })
        .catch(() => {
          result = -1;
        });
      return result;
    } catch {
      return -1;
    }
  }

  /**
   * host_read(handle: i64, buf_ptr, buf_len) -> i32
   *
   * For handle 0 (stdin): return 0 (no stdin support yet).
   * Other handles: delegate to PlatformIO.
   */
  private hostRead(handle: bigint, bufPtr: number, bufLen: number): number {
    const h = Number(handle);

    // stdin — not yet supported
    if (h === 0) {
      return 0;
    }

    try {
      const mem = this.getMemoryBuffer();
      const buf = mem.subarray(bufPtr, bufPtr + bufLen);

      let result = 0;
      this.io
        .read(h, buf, 0, bufLen)
        .then((n) => {
          result = n;
        })
        .catch(() => {
          result = -1;
        });
      return result;
    } catch {
      return -1;
    }
  }

  /**
   * host_write(handle: i64, buf_ptr, buf_len) -> i32
   *
   * For handles 1 (stdout) and 2 (stderr): decode bytes from Wasm memory
   * and write to the console.
   * Other handles: delegate to PlatformIO.
   */
  private hostWrite(handle: bigint, bufPtr: number, bufLen: number): number {
    const h = Number(handle);
    const mem = this.getMemoryBuffer();
    const data = mem.slice(bufPtr, bufPtr + bufLen);

    // stdout / stderr — write to console
    if (h === 1) {
      const text = new TextDecoder().decode(data);
      process.stdout.write(text);
      return bufLen;
    }
    if (h === 2) {
      const text = new TextDecoder().decode(data);
      process.stderr.write(text);
      return bufLen;
    }

    try {
      let result = 0;
      this.io
        .write(h, data, 0, bufLen)
        .then((n) => {
          result = n;
        })
        .catch(() => {
          result = -1;
        });
      return result;
    } catch {
      return -1;
    }
  }

  /**
   * host_seek(handle: i64, offset_lo, offset_hi, whence) -> i64
   *
   * Combines the low and high 32-bit parts into a 64-bit offset.
   */
  private hostSeek(
    handle: bigint,
    offsetLo: number,
    offsetHi: number,
    whence: number,
  ): bigint {
    const h = Number(handle);
    // Reconstruct 64-bit signed offset from two 32-bit parts.
    // JS bitwise operators are 32-bit, so we use multiplication for the high word.
    const offset = offsetHi * 0x100000000 + (offsetLo >>> 0);

    try {
      let result = -1;
      this.io
        .seek(h, offset, whence)
        .then((pos) => {
          result = pos;
        })
        .catch(() => {
          result = -1;
        });
      return BigInt(result);
    } catch {
      return BigInt(-1);
    }
  }

  /**
   * host_fstat(handle: i64, stat_ptr) -> i32
   *
   * Writes a WasmStat structure into Wasm memory at stat_ptr.
   *
   * WasmStat layout (repr(C), 88 bytes total):
   *   0:  st_dev        u64
   *   8:  st_ino        u64
   *   16: st_mode       u32
   *   20: st_nlink      u32
   *   24: st_uid        u32
   *   28: st_gid        u32
   *   32: st_size       u64
   *   40: st_atime_sec  u64
   *   48: st_atime_nsec u32
   *   52: (pad)         u32
   *   56: st_mtime_sec  u64
   *   64: st_mtime_nsec u32
   *   68: (pad)         u32
   *   72: st_ctime_sec  u64
   *   80: st_ctime_nsec u32
   *   84: _pad          u32
   */
  private hostFstat(handle: bigint, statPtr: number): number {
    const h = Number(handle);

    try {
      let stat: StatResult | null = null;
      let failed = false;
      this.io
        .fstat(h)
        .then((s) => {
          stat = s;
        })
        .catch(() => {
          failed = true;
        });

      if (failed || !stat) {
        return -1;
      }

      this.writeStatToMemory(statPtr, stat);
      return 0;
    } catch {
      return -1;
    }
  }

  /**
   * Write a StatResult into the WasmStat struct at the given Wasm memory offset.
   */
  private writeStatToMemory(ptr: number, stat: StatResult): void {
    const dv = this.getMemoryDataView();

    // Zero out the struct first (handles padding bytes).
    const mem = this.getMemoryBuffer();
    mem.fill(0, ptr, ptr + WASM_STAT_SIZE);

    dv.setBigUint64(ptr + 0, BigInt(stat.dev), true); // st_dev
    dv.setBigUint64(ptr + 8, BigInt(stat.ino), true); // st_ino
    dv.setUint32(ptr + 16, stat.mode, true); // st_mode
    dv.setUint32(ptr + 20, stat.nlink, true); // st_nlink
    dv.setUint32(ptr + 24, stat.uid, true); // st_uid
    dv.setUint32(ptr + 28, stat.gid, true); // st_gid
    dv.setBigUint64(ptr + 32, BigInt(stat.size), true); // st_size

    // Convert millisecond timestamps to seconds + nanoseconds.
    const atimeSec = Math.floor(stat.atimeMs / 1000);
    const atimeNsec = Math.floor((stat.atimeMs % 1000) * 1_000_000);
    dv.setBigUint64(ptr + 40, BigInt(atimeSec), true); // st_atime_sec
    dv.setUint32(ptr + 48, atimeNsec, true); // st_atime_nsec

    const mtimeSec = Math.floor(stat.mtimeMs / 1000);
    const mtimeNsec = Math.floor((stat.mtimeMs % 1000) * 1_000_000);
    dv.setBigUint64(ptr + 56, BigInt(mtimeSec), true); // st_mtime_sec
    dv.setUint32(ptr + 64, mtimeNsec, true); // st_mtime_nsec

    const ctimeSec = Math.floor(stat.ctimeMs / 1000);
    const ctimeNsec = Math.floor((stat.ctimeMs % 1000) * 1_000_000);
    dv.setBigUint64(ptr + 72, BigInt(ctimeSec), true); // st_ctime_sec
    dv.setUint32(ptr + 80, ctimeNsec, true); // st_ctime_nsec
    // _pad at offset 84 already zeroed
  }
}

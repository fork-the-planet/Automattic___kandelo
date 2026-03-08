/**
 * Node.js platform I/O backend.
 *
 * Implements the PlatformIO interface using synchronous Node.js `fs`
 * operations. Synchronous methods are used because the kernel runs in
 * a worker context and we need deterministic, blocking behavior that
 * aligns with the Wasm import calling convention.
 */

import * as fs from "node:fs";
import type { PlatformIO, StatResult } from "../types";

export class NodePlatformIO implements PlatformIO {
  private dirHandles = new Map<number, fs.Dir>();
  private nextDirHandle = 1;

  async open(path: string, flags: number, mode: number): Promise<number> {
    return fs.openSync(path, flags, mode);
  }

  async close(handle: number): Promise<number> {
    fs.closeSync(handle);
    return 0;
  }

  async read(
    handle: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
  ): Promise<number> {
    return fs.readSync(handle, buffer, 0, length, offset);
  }

  async write(
    handle: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
  ): Promise<number> {
    return fs.writeSync(handle, buffer, 0, length, offset);
  }

  async seek(
    handle: number,
    offset: number,
    whence: number,
  ): Promise<number> {
    // Node.js does not have a direct seekSync equivalent. We calculate
    // the new position ourselves by reading the current stats when
    // needed and using pread/pwrite for positional I/O.
    //
    // SEEK_SET=0, SEEK_CUR=1, SEEK_END=2
    switch (whence) {
      case 0: // SEEK_SET
        return offset;
      case 1: // SEEK_CUR — not directly supportable without tracking
        // position state; return the offset as a relative delta indicator.
        // The caller (kernel) maintains the canonical position.
        return offset;
      case 2: {
        // SEEK_END — compute from file size
        const stat = fs.fstatSync(handle);
        return stat.size + offset;
      }
      default:
        throw new Error(`Invalid whence value: ${whence}`);
    }
  }

  async fstat(handle: number): Promise<StatResult> {
    const stat = fs.fstatSync(handle);
    return {
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      nlink: stat.nlink,
      uid: stat.uid,
      gid: stat.gid,
      size: stat.size,
      atimeMs: stat.atimeMs,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    };
  }

  async stat(path: string): Promise<StatResult> {
    const s = fs.statSync(path);
    return {
      dev: s.dev,
      ino: s.ino,
      mode: s.mode,
      nlink: s.nlink,
      uid: s.uid,
      gid: s.gid,
      size: s.size,
      atimeMs: s.atimeMs,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
    };
  }

  async lstat(path: string): Promise<StatResult> {
    const s = fs.lstatSync(path);
    return {
      dev: s.dev,
      ino: s.ino,
      mode: s.mode,
      nlink: s.nlink,
      uid: s.uid,
      gid: s.gid,
      size: s.size,
      atimeMs: s.atimeMs,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
    };
  }

  async mkdir(path: string, mode: number): Promise<void> {
    fs.mkdirSync(path, { mode });
  }

  async rmdir(path: string): Promise<void> {
    fs.rmdirSync(path);
  }

  async unlink(path: string): Promise<void> {
    fs.unlinkSync(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    fs.renameSync(oldPath, newPath);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    fs.linkSync(existingPath, newPath);
  }

  async symlink(target: string, path: string): Promise<void> {
    fs.symlinkSync(target, path);
  }

  async readlink(path: string): Promise<string> {
    return fs.readlinkSync(path, "utf8");
  }

  async chmod(path: string, mode: number): Promise<void> {
    fs.chmodSync(path, mode);
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    fs.chownSync(path, uid, gid);
  }

  async access(path: string, mode: number): Promise<void> {
    fs.accessSync(path, mode);
  }

  async opendir(path: string): Promise<number> {
    const dir = fs.opendirSync(path);
    const handle = this.nextDirHandle++;
    this.dirHandles.set(handle, dir);
    return handle;
  }

  async readdir(
    handle: number,
  ): Promise<{ name: string; type: number; ino: number } | null> {
    const dir = this.dirHandles.get(handle);
    if (!dir) throw new Error("Invalid dir handle");
    const entry = dir.readSync();
    if (!entry) return null;
    // Map Dirent to d_type
    let dtype = 0; // DT_UNKNOWN
    if (entry.isFile()) dtype = 8; // DT_REG
    else if (entry.isDirectory()) dtype = 4; // DT_DIR
    else if (entry.isSymbolicLink()) dtype = 10; // DT_LNK
    else if (entry.isFIFO()) dtype = 1; // DT_FIFO
    else if (entry.isSocket()) dtype = 12; // DT_SOCK
    else if (entry.isCharacterDevice()) dtype = 2; // DT_CHR
    else if (entry.isBlockDevice()) dtype = 6; // DT_BLK
    return { name: entry.name, type: dtype, ino: 0 };
  }

  async closedir(handle: number): Promise<void> {
    const dir = this.dirHandles.get(handle);
    if (!dir) throw new Error("Invalid dir handle");
    dir.closeSync();
    this.dirHandles.delete(handle);
  }

  async ftruncate(handle: number, length: number): Promise<void> {
    fs.ftruncateSync(handle, length);
  }

  async fsync(handle: number): Promise<void> {
    fs.fsyncSync(handle);
  }

  async fchmod(handle: number, mode: number): Promise<void> {
    fs.fchmodSync(handle, mode);
  }

  async fchown(handle: number, uid: number, gid: number): Promise<void> {
    fs.fchownSync(handle, uid, gid);
  }

  async clockGettime(
    clockId: number,
  ): Promise<{ sec: number; nsec: number }> {
    if (clockId === 1) {
      // CLOCK_MONOTONIC: use process.hrtime.bigint()
      const ns = process.hrtime.bigint();
      const sec = Number(ns / 1000000000n);
      const nsec = Number(ns % 1000000000n);
      return { sec, nsec };
    }
    // CLOCK_REALTIME
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const nsec = (now % 1000) * 1_000_000;
    return { sec, nsec };
  }

  async nanosleep(sec: number, nsec: number): Promise<void> {
    const ms = sec * 1000 + Math.floor(nsec / 1_000_000);
    if (ms > 0) {
      const sab = new SharedArrayBuffer(4);
      const arr = new Int32Array(sab);
      Atomics.wait(arr, 0, 0, ms);
    }
  }
}

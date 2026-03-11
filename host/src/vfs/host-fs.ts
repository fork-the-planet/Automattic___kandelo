/**
 * HostFileSystem — a Node.js passthrough FileSystemBackend.
 *
 * All paths are sandboxed under `rootPath`; any attempt to escape
 * via `../` or symlinks resolving outside the root is rejected.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { StatResult } from "../types";
import type { FileSystemBackend, DirEntry } from "./types";
import { translateOpenFlags } from "./flags";

export class HostFileSystem implements FileSystemBackend {
  private rootPath: string;
  private fdPositions = new Map<number, number>();
  private dirHandles = new Map<number, fs.Dir>();
  private nextDirHandle = 1;

  constructor(rootPath: string) {
    this.rootPath = nodePath.resolve(rootPath);
  }

  /**
   * Resolve a mount-relative path to an absolute host path,
   * ensuring it stays within `rootPath`.
   */
  private safePath(relative: string): string {
    const resolved = nodePath.resolve(
      this.rootPath,
      relative.replace(/^\//, ""),
    );
    if (resolved !== this.rootPath && !resolved.startsWith(this.rootPath + "/")) {
      throw new Error("EACCES: path traversal blocked");
    }
    return resolved;
  }

  private toStatResult(s: fs.Stats): StatResult {
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

  // ── File handle operations ───────────────────────────────────

  open(path: string, flags: number, mode: number): number {
    const fd = fs.openSync(
      this.safePath(path),
      translateOpenFlags(flags),
      mode,
    );
    this.fdPositions.set(fd, 0);
    return fd;
  }

  close(handle: number): number {
    fs.closeSync(handle);
    this.fdPositions.delete(handle);
    return 0;
  }

  read(
    handle: number,
    buffer: Uint8Array,
    offset: number | null,
    length: number,
  ): number {
    const pos = offset ?? this.fdPositions.get(handle) ?? 0;
    const bytesRead = fs.readSync(handle, buffer, 0, length, pos);
    if (offset === null) {
      this.fdPositions.set(handle, pos + bytesRead);
    }
    return bytesRead;
  }

  write(
    handle: number,
    buffer: Uint8Array,
    offset: number | null,
    length: number,
  ): number {
    const pos = offset ?? this.fdPositions.get(handle) ?? 0;
    const bytesWritten = fs.writeSync(handle, buffer, 0, length, pos);
    if (offset === null) {
      this.fdPositions.set(handle, pos + bytesWritten);
    }
    return bytesWritten;
  }

  seek(handle: number, offset: number, whence: number): number {
    let newPos: number;
    switch (whence) {
      case 0: // SEEK_SET
        newPos = offset;
        break;
      case 1: // SEEK_CUR
        newPos = (this.fdPositions.get(handle) ?? 0) + offset;
        break;
      case 2: // SEEK_END
        newPos = fs.fstatSync(handle).size + offset;
        break;
      default:
        throw new Error(`Invalid whence value: ${whence}`);
    }
    this.fdPositions.set(handle, newPos);
    return newPos;
  }

  fstat(handle: number): StatResult {
    return this.toStatResult(fs.fstatSync(handle));
  }

  ftruncate(handle: number, length: number): void {
    fs.ftruncateSync(handle, length);
  }

  fsync(handle: number): void {
    fs.fsyncSync(handle);
  }

  fchmod(handle: number, mode: number): void {
    fs.fchmodSync(handle, mode);
  }

  fchown(handle: number, uid: number, gid: number): void {
    fs.fchownSync(handle, uid, gid);
  }

  // ── Path-based operations ───────────────────────────────────

  stat(path: string): StatResult {
    return this.toStatResult(fs.statSync(this.safePath(path)));
  }

  lstat(path: string): StatResult {
    return this.toStatResult(fs.lstatSync(this.safePath(path)));
  }

  mkdir(path: string, mode: number): void {
    fs.mkdirSync(this.safePath(path), { mode });
  }

  rmdir(path: string): void {
    fs.rmdirSync(this.safePath(path));
  }

  unlink(path: string): void {
    fs.unlinkSync(this.safePath(path));
  }

  rename(oldPath: string, newPath: string): void {
    fs.renameSync(this.safePath(oldPath), this.safePath(newPath));
  }

  link(existingPath: string, newPath: string): void {
    fs.linkSync(this.safePath(existingPath), this.safePath(newPath));
  }

  symlink(target: string, path: string): void {
    fs.symlinkSync(target, this.safePath(path));
  }

  readlink(path: string): string {
    return fs.readlinkSync(this.safePath(path), "utf8");
  }

  chmod(path: string, mode: number): void {
    fs.chmodSync(this.safePath(path), mode);
  }

  chown(path: string, uid: number, gid: number): void {
    fs.chownSync(this.safePath(path), uid, gid);
  }

  access(path: string, mode: number): void {
    fs.accessSync(this.safePath(path), mode);
  }

  // ── Directory iteration ─────────────────────────────────────

  opendir(path: string): number {
    const dir = fs.opendirSync(this.safePath(path));
    const handle = this.nextDirHandle++;
    this.dirHandles.set(handle, dir);
    return handle;
  }

  readdir(handle: number): DirEntry | null {
    const dir = this.dirHandles.get(handle);
    if (!dir) throw new Error("Invalid dir handle");
    const entry = dir.readSync();
    if (!entry) return null;

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

  closedir(handle: number): void {
    const dir = this.dirHandles.get(handle);
    if (!dir) throw new Error("Invalid dir handle");
    dir.closeSync();
    this.dirHandles.delete(handle);
  }
}

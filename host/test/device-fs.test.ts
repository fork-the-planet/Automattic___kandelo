import { describe, it, expect } from "vitest";
import { DeviceFileSystem } from "../src/vfs/device-fs";

describe("DeviceFileSystem", () => {
  it("opens and closes /dev/null", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/null", 0, 0);
    expect(h).toBeGreaterThan(0);
    expect(fs.close(h)).toBe(0);
  });

  it("/dev/null reads return 0 (EOF)", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/null", 0, 0);
    const buf = new Uint8Array(64);
    expect(fs.read(h, buf, null, 64)).toBe(0);
    fs.close(h);
  });

  it("/dev/null writes succeed and report length", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/null", 1, 0);
    const buf = new Uint8Array([1, 2, 3, 4]);
    expect(fs.write(h, buf, null, 4)).toBe(4);
    fs.close(h);
  });

  it("/dev/zero reads return zero bytes", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/zero", 0, 0);
    const buf = new Uint8Array(32);
    buf.fill(0xff);
    const n = fs.read(h, buf, null, 32);
    expect(n).toBe(32);
    expect(buf.every((b) => b === 0)).toBe(true);
    fs.close(h);
  });

  it("/dev/urandom reads return non-zero bytes (probabilistic)", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/urandom", 0, 0);
    const buf = new Uint8Array(256);
    const n = fs.read(h, buf, null, 256);
    expect(n).toBe(256);
    // With 256 bytes, probability of all zeros is ~0
    const nonZero = buf.some((b) => b !== 0);
    expect(nonZero).toBe(true);
    fs.close(h);
  });

  it("/dev/random reads same as urandom", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/random", 0, 0);
    const buf = new Uint8Array(64);
    expect(fs.read(h, buf, null, 64)).toBe(64);
    fs.close(h);
  });

  it("stat on /dev/null returns character device", () => {
    const fs = new DeviceFileSystem();
    const st = fs.stat("/null");
    expect(st.mode & 0o170000).toBe(0o020000); // S_IFCHR
    expect(st.size).toBe(0);
  });

  it("stat on root returns directory", () => {
    const fs = new DeviceFileSystem();
    const st = fs.stat("/");
    expect(st.mode & 0o170000).toBe(0o040000); // S_IFDIR
  });

  it("throws ENOENT for unknown device", () => {
    const fs = new DeviceFileSystem();
    expect(() => fs.open("/nonexistent", 0, 0)).toThrow("ENOENT");
    expect(() => fs.stat("/nonexistent")).toThrow("ENOENT");
  });

  it("throws EBADF for invalid handle", () => {
    const fs = new DeviceFileSystem();
    expect(() => fs.read(999, new Uint8Array(1), null, 1)).toThrow("EBADF");
    expect(() => fs.close(999)).toThrow("EBADF");
  });

  it("readdir lists all device files", () => {
    const fs = new DeviceFileSystem();
    const dh = fs.opendir("/");
    const entries: string[] = [];
    let entry;
    while ((entry = fs.readdir(dh)) !== null) {
      entries.push(entry.name);
      expect(entry.type).toBe(2); // DT_CHR
    }
    fs.closedir(dh);
    expect(entries).toContain("null");
    expect(entries).toContain("zero");
    expect(entries).toContain("urandom");
    expect(entries).toContain("random");
  });

  it("seek is a no-op on character devices", () => {
    const fs = new DeviceFileSystem();
    const h = fs.open("/null", 0, 0);
    expect(fs.seek(h, 100, 0)).toBe(0);
    fs.close(h);
  });

  it("works with VirtualPlatformIO mount", async () => {
    // Import dynamically to avoid circular issues
    const { VirtualPlatformIO } = await import("../src/vfs/vfs");
    const { MemoryFileSystem } = await import("../src/vfs/memory-fs");
    const { NodeTimeProvider } = await import("../src/vfs/time");

    const memfs = MemoryFileSystem.create(new SharedArrayBuffer(1024 * 1024));
    const devfs = new DeviceFileSystem();
    memfs.mkdir("/dev", 0o755);

    const io = new VirtualPlatformIO(
      [
        { mountPoint: "/dev", backend: devfs },
        { mountPoint: "/", backend: memfs },
      ],
      new NodeTimeProvider(),
    );

    // Write to /dev/null
    const h = io.open("/dev/null", 1, 0);
    expect(io.write(h, new Uint8Array([1, 2, 3]), null, 3)).toBe(3);
    io.close(h);

    // Read from /dev/zero
    const h2 = io.open("/dev/zero", 0, 0);
    const buf = new Uint8Array(16);
    buf.fill(0xff);
    expect(io.read(h2, buf, null, 16)).toBe(16);
    expect(buf[0]).toBe(0);
    io.close(h2);

    // Read from /dev/urandom
    const h3 = io.open("/dev/urandom", 0, 0);
    const rbuf = new Uint8Array(32);
    expect(io.read(h3, rbuf, null, 32)).toBe(32);
    io.close(h3);
  });
});

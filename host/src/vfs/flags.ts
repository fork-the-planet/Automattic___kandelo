/**
 * Translate Linux/POSIX open flags (as used by musl libc) to the
 * platform-native flag values that Node.js `fs.openSync` expects.
 * The numeric values differ between Linux and macOS/BSD.
 */

import * as fs from "node:fs";

export function translateOpenFlags(linuxFlags: number): number {
  // Linux flag constants (octal)
  const L_O_WRONLY = 0o1;
  const L_O_RDWR = 0o2;
  const L_O_CREAT = 0o100;
  const L_O_EXCL = 0o200;
  const L_O_NOCTTY = 0o400;
  const L_O_TRUNC = 0o1000;
  const L_O_APPEND = 0o2000;
  const L_O_NONBLOCK = 0o4000;
  const L_O_DIRECTORY = 0o200000;
  const L_O_NOFOLLOW = 0o400000;

  let native = 0;

  // Access mode (bottom 2 bits)
  if (linuxFlags & L_O_RDWR) native |= fs.constants.O_RDWR;
  else if (linuxFlags & L_O_WRONLY) native |= fs.constants.O_WRONLY;
  // else O_RDONLY = 0

  if (linuxFlags & L_O_CREAT) native |= fs.constants.O_CREAT;
  if (linuxFlags & L_O_EXCL) native |= fs.constants.O_EXCL;
  if (linuxFlags & L_O_TRUNC) native |= fs.constants.O_TRUNC;
  if (linuxFlags & L_O_APPEND) native |= fs.constants.O_APPEND;
  if (linuxFlags & L_O_NONBLOCK) native |= fs.constants.O_NONBLOCK;
  if ((linuxFlags & L_O_DIRECTORY) && fs.constants.O_DIRECTORY)
    native |= fs.constants.O_DIRECTORY;
  if ((linuxFlags & L_O_NOFOLLOW) && fs.constants.O_NOFOLLOW)
    native |= fs.constants.O_NOFOLLOW;
  if ((linuxFlags & L_O_NOCTTY) && fs.constants.O_NOCTTY)
    native |= fs.constants.O_NOCTTY;
  // O_LARGEFILE and O_CLOEXEC have no Node.js equivalent; ignored.

  return native;
}

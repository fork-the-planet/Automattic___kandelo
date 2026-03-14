import { describe, it, expect } from 'vitest';
import { buildClangArgs } from '../src/bin/cc.ts';

describe('buildClangArgs', () => {
  const toolchain = {
    llvmDir: '/opt/llvm/bin',
    cc: '/opt/llvm/bin/clang',
    cxx: '/opt/llvm/bin/clang++',
    ar: '/opt/llvm/bin/llvm-ar',
    ranlib: '/opt/llvm/bin/llvm-ranlib',
    nm: '/opt/llvm/bin/llvm-nm',
    sysroot: '/tmp/sysroot',
    glueDir: '/tmp/glue',
  };

  it('compile-only: adds compile flags, no link flags', () => {
    const args = buildClangArgs(['-c', 'foo.c', '-o', 'foo.o'], toolchain);
    expect(args).toContain('--target=wasm32-unknown-unknown');
    expect(args).toContain('--sysroot=/tmp/sysroot');
    expect(args).toContain('-c');
    expect(args).toContain('foo.c');
    expect(args).not.toContain('-Wl,--entry=_start');
    expect(args.join(' ')).not.toContain('syscall_glue.c');
  });

  it('compile+link: adds both compile and link flags plus glue', () => {
    const args = buildClangArgs(['foo.c', '-o', 'foo.wasm'], toolchain);
    expect(args).toContain('--target=wasm32-unknown-unknown');
    expect(args).toContain('-Wl,--entry=_start');
    expect(args).toContain('-Wl,--import-memory');
    expect(args.join(' ')).toContain('syscall_glue.c');
    expect(args.join(' ')).toContain('compiler_rt.c');
    expect(args.join(' ')).toContain('crt1.o');
    expect(args.join(' ')).toContain('libc.a');
  });

  it('link-only: object files without -c get link flags but not compile-only flags', () => {
    const args = buildClangArgs(['foo.o', 'bar.o', '-o', 'out.wasm'], toolchain);
    expect(args).toContain('-Wl,--entry=_start');
    expect(args.join(' ')).toContain('libc.a');
    expect(args).toContain('--target=wasm32-unknown-unknown');
    // Compile-only flags should not be present in link-only mode
    expect(args).not.toContain('-fno-exceptions');
    expect(args).not.toContain('-fno-trapping-math');
  });

  it('preprocess-only: no link flags', () => {
    const args = buildClangArgs(['-E', 'foo.c'], toolchain);
    expect(args).not.toContain('-Wl,--entry=_start');
  });

  it('filters ignored flags', () => {
    const args = buildClangArgs(['-c', '-pthread', '-fPIC', 'foo.c'], toolchain);
    expect(args).not.toContain('-pthread');
    expect(args).not.toContain('-fPIC');
  });
});

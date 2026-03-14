import { describe, it, expect } from 'vitest';
import { buildConfigureEnv, buildConfigureArgs } from '../src/bin/configure.ts';

describe('buildConfigureArgs', () => {
  it('includes --host and --prefix', () => {
    const args = buildConfigureArgs([]);
    expect(args).toContain('--host=wasm32-unknown-none');
    expect(args).toContain('--prefix=/usr');
  });

  it('forwards extra user args', () => {
    const args = buildConfigureArgs(['--disable-shared', '--without-pear']);
    expect(args).toContain('--disable-shared');
    expect(args).toContain('--without-pear');
  });
});

describe('buildConfigureEnv', () => {
  it('sets CC to wasm32posix-cc', () => {
    const env = buildConfigureEnv();
    expect(env.CC).toBe('wasm32posix-cc');
    expect(env.AR).toBe('wasm32posix-ar');
    expect(env.STRIP).toBe('wasm32posix-strip');
  });
});

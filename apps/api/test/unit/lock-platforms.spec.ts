/**
 * The lock lists the native binaries for every platform.
 *
 * A lock created on one machine keeps only that machine's optional platform
 * packages (an npm limitation). Here it held darwin-x64 only, so on Linux
 * `npm ci` installed no SWC/esbuild/rollup binary and the Next build
 * downloaded SWC at build time. The missing entries were added on their own
 * (no full regeneration); this test keeps them complete.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lock = JSON.parse(readFileSync(resolve(__dirname, '../../../../package-lock.json'), 'utf8'));
const packages: Record<string, any> = lock.packages;

/** Parents whose optionalDependencies are platform binaries. */
const PARENTS = ['node_modules/next', 'node_modules/esbuild', 'node_modules/rollup', 'node_modules/@sentry/cli', 'node_modules/unrs-resolver'];
/** Platform packages deliberately not in the lock — with the reason. */
const LEFT_OUT: Record<string, string> = {
  '@unrs/resolver-binding-wasm32-wasi': 'has its own dependencies; wasm32 only',
};

it.each(PARENTS)('%s: every declared platform package is in the lock', (parent) => {
  const p = packages[parent];
  expect(p).toBeDefined();
  const base = parent.slice(0, parent.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const missing = Object.keys(p.optionalDependencies ?? {}).filter((name) => !packages[base + name] && !(name in LEFT_OUT));
  expect(missing).toEqual([]);
});

it('the Linux x64 binaries CI needs are there (glibc)', () => {
  for (const name of ['@next/swc-linux-x64-gnu', '@esbuild/linux-x64', '@rollup/rollup-linux-x64-gnu', '@sentry/cli-linux-x64', '@unrs/resolver-binding-linux-x64-gnu']) {
    const e = packages[`node_modules/${name}`];
    expect([name, e?.optional, e?.os, e?.cpu]).toEqual([name, true, expect.arrayContaining(['linux']), expect.arrayContaining(['x64'])]);
  }
});

it('added entries carry resolved and integrity', () => {
  const added = ['@next/swc-linux-x64-gnu', '@esbuild/linux-x64', '@rollup/rollup-linux-x64-gnu'].map((n) => packages[`node_modules/${n}`]);
  for (const e of added) expect(e.integrity).toMatch(/^sha512-/);
});

/**
 * One React in the lockfile (Next 15.5 + React 19, docs/NEXT15-ESTIMATE.md).
 *
 * Raising React with `npm install` left the old React 18 and `@types/react`
 * 18 at the workspace root and put the new ones in `apps/web/node_modules`.
 * `next`, `recharts` and `zustand` (at the root) then saw React 18, and `tsc`
 * gave 16 "'Bar' cannot be used as a JSX component" errors. The install
 * itself "succeeded" — this test keeps exactly one copy of each package in
 * the lockfile, at the root, in the major version apps/web declares.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const packages: Record<string, { version: string }> = lock.packages;
const web = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'));
const declared: Record<string, string> = { ...web.dependencies, ...web.devDependencies };

const SINGLE = ['react', 'react-dom', '@types/react', '@types/react-dom'];
const major = (v: string) => v.replace(/^[^\d]*/, '').split('.')[0];

describe('one React in the lock', () => {
  it.each(SINGLE)('%s: exactly one copy, at the workspace root', (name) => {
    const copies = Object.keys(packages).filter((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    expect(copies).toEqual([`node_modules/${name}`]);
  });

  it.each(SINGLE)('%s: the copy has the major version apps/web declares', (name) => {
    expect([name, major(packages[`node_modules/${name}`].version)]).toEqual([name, major(declared[name])]);
  });
});

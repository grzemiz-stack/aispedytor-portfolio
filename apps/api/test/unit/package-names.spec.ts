/**
 * Package names: `aispedytor` (workspace root), `@aispedytor/api`,
 * `@aispedytor/web` — in the manifests and in the lock file alike, so that
 * `npm ci` installs the workspaces under those names.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

it('manifests carry the package names', () => {
  expect(json('package.json').name).toBe('aispedytor');
  expect(json('apps/api/package.json').name).toBe('@aispedytor/api');
  expect(json('apps/web/package.json').name).toBe('@aispedytor/web');
});

it('the lock file matches the manifests', () => {
  const lock = json('package-lock.json');
  expect(lock.name).toBe('aispedytor');
  expect(lock.packages[''].name).toBe('aispedytor');
  expect(lock.packages['apps/api'].name).toBe('@aispedytor/api');
  expect(lock.packages['apps/web'].name).toBe('@aispedytor/web');
  expect(lock.packages['node_modules/@aispedytor/api'].resolved).toBe('apps/api');
  expect(lock.packages['node_modules/@aispedytor/web'].resolved).toBe('apps/web');
  expect(JSON.stringify(lock)).not.toContain('ai-spedytor');
});

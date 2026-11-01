/**
 * docs/DEPLOYMENT.md stays in step with the code: every environment variable
 * the API or the web app reads is described there, every migration it names
 * exists, and the API template carries no one's real contact.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const doc = readFileSync(resolve(root, 'docs/DEPLOYMENT.md'), 'utf8');

function sources(dir: string, recursive = true): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return recursive ? sources(path) : [];
    return /\.(ts|tsx|js)$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `src/` of an app plus its top-level config files (next.config.js, sentry.*.config.ts). */
function envVarsReadBy(app: string): string[] {
  const names = new Set<string>();
  for (const file of [...sources(join(app, 'src')), ...sources(app, false)]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
    for (const m of text.matchAll(/config(?:Service)?\.(?:get|getOrThrow)(?:<[^>]+>)?\(\s*['"]([A-Z0-9_]+)['"]/g)) names.add(m[1]);
  }
  return [...names].sort();
}

it.each([
  ['api', resolve(root, 'apps/api')],
  ['web', resolve(root, 'apps/web')],
])('every variable the %s reads is described', (_name, dir) => {
  const vars = envVarsReadBy(dir);
  expect(vars.length).toBeGreaterThan(0);
  expect(vars.filter((v) => !doc.includes(`\`${v}\``))).toEqual([]);
});

it('the migrations it names exist', () => {
  const named = [...doc.matchAll(/`(\d{14}_[a-z0-9_]+)`/g)].map((m) => m[1]);
  expect(named.length).toBeGreaterThanOrEqual(3);
  for (const name of named) {
    expect(existsSync(resolve(root, 'apps/api/prisma/migrations', name, 'migration.sql'))).toBe(true);
  }
});

it('the API env template has no real contact address', () => {
  const template = readFileSync(resolve(root, 'apps/api/.env.example'), 'utf8');
  expect(template).toMatch(/^NOMINATIM_CONTACT_EMAIL=""$/m);
  expect(template).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
});

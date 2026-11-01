/**
 * `apps/web/.env.example` — every key is read by the web code (`src/`) or the
 * Next configuration (`next.config.js`), otherwise the example promises a
 * setting nothing listens to; and every variable that code reads is in the
 * example (`SENTRY_AUTH_TOKEN` was read but missing).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WEB = resolve(__dirname, '../..');
const example = readFileSync(join(WEB, '.env.example'), 'utf8');
const keys = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
const config = ['next.config.js', 'sentry.server.config.ts', 'sentry.edge.config.ts']
  .map((f) => join(WEB, f))
  .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
const code = [...files(join(WEB, 'src')), ...config].map((f) => readFileSync(f, 'utf8')).join('\n');

it.each(keys)('%s is read somewhere', (key) => {
  expect([key, new RegExp(`\\b${key}\\b`).test(code)]).toEqual([key, true]);
});

it('every process.env variable the web code reads is in the example (Next sets NODE_ENV and NEXT_RUNTIME itself)', () => {
  const read = [...new Set([...code.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  expect(read.filter((k) => !keys.includes(k) && !['NODE_ENV', 'NEXT_RUNTIME'].includes(k)).sort()).toEqual([]);
});

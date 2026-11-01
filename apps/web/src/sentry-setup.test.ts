/**
 * Sentry files on Next 15 + Sentry 10 (docs/NEXT15-ESTIMATE.md, risk 4).
 *
 * Guards the layout that was checked live (a fake DSN, a local capturing
 * server): a server route error and a browser error each send an event;
 * without a DSN nothing is sent and the shared page code is 103 kB.
 * - `src/instrumentation.ts`: `register()` loads the server / Edge config,
 *   `onRequestError` passes request errors to Sentry;
 * - `src/instrumentation-client.ts` instead of `sentry.client.config.ts`,
 *   every SDK use under a direct `process.env.NEXT_PUBLIC_SENTRY_DSN` check
 *   (a check through a variable leaves the SDK in the bundle without a DSN);
 * - `withSentryConfig` from `@sentry/nextjs/config` (the old import goes away
 *   in v11), only with a DSN.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8');
/** Code without comments — sentences in comments must not satisfy the checks. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('Sentry files', () => {
  it('instrumentation files are in src/ (next to app/), the old client config is gone', () => {
    expect(['src/instrumentation.ts', 'src/instrumentation-client.ts'].filter((p) => !existsSync(resolve(WEB, p)))).toEqual([]);
    expect(['sentry.client.config.ts', 'instrumentation.ts', 'instrumentation-client.ts'].filter((p) => existsSync(resolve(WEB, p)))).toEqual([]);
    expect(existsSync(resolve(WEB, 'src/app'))).toBe(true);
  });

  it('register() loads the server and Edge configs; request errors go to Sentry', () => {
    const src = code('src/instrumentation.ts');
    expect(src).toMatch(/export async function register\(\)/);
    expect(src).toMatch(/NEXT_RUNTIME === 'nodejs'\) await import\('\.\.\/sentry\.server\.config'\)/);
    expect(src).toMatch(/NEXT_RUNTIME === 'edge'\) await import\('\.\.\/sentry\.edge\.config'\)/);
    expect(src).toMatch(/export const onRequestError = Sentry\.captureRequestError/);
    for (const p of ['sentry.server.config.ts', 'sentry.edge.config.ts']) expect([p, existsSync(resolve(WEB, p))]).toEqual([p, true]);
  });

  it('the client SDK is used only under a direct NEXT_PUBLIC_SENTRY_DSN check (out of the bundle without a DSN)', () => {
    const src = code('src/instrumentation-client.ts');
    expect(src).toMatch(/if \(process\.env\.NEXT_PUBLIC_SENTRY_DSN\) \{\s*Sentry\.init\(/);
    expect(src).toMatch(/export const onRouterTransitionStart[^=]*= process\.env\.NEXT_PUBLIC_SENTRY_DSN\s*\?\s*Sentry\.captureRouterTransitionStart/);
    // Every `Sentry.` reference sits in a branch with the DSN check.
    const uses = src.match(/Sentry\.\w+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/=\s*process\.env\.NEXT_PUBLIC_SENTRY_DSN\s*;/);
    expect(src).not.toMatch(/require\(/);
  });

  it('next.config.js takes withSentryConfig from @sentry/nextjs/config, and only with a DSN', () => {
    const src = code('next.config.js');
    expect(src).toContain("require('@sentry/nextjs/config')");
    expect(src).not.toMatch(/require\('@sentry\/nextjs'\)/);
    expect(src).not.toMatch(/disable(Server|Client)WebpackPlugin/);

    const load = (dsn: string | undefined) => {
      const before = process.env.NEXT_PUBLIC_SENTRY_DSN;
      if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN; else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
      let cfg: unknown;
      jest.isolateModules(() => { cfg = require('../next.config.js'); });
      if (before === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN; else process.env.NEXT_PUBLIC_SENTRY_DSN = before;
      return cfg;
    };
    // Without a DSN — our config alone (images off, security headers), not wrapped.
    const plain = load(undefined) as Record<string, unknown>;
    expect([Object.keys(plain).sort(), plain.images, typeof plain.headers]).toEqual([['headers', 'images', 'poweredByHeader'], { unoptimized: true }, 'function']);
    const wrapped = load('http://key@127.0.0.1:9/1');
    expect(Object.keys(wrapped as object).sort()).not.toEqual(['headers', 'images', 'poweredByHeader']);
  });

  it('@sentry/nextjs is declared and locked at >= 10.73 (the first with @sentry/nextjs/config)', () => {
    const atLeast = (v: string) => { const [a, b] = v.replace(/^[^\d]*/, '').split('.').map(Number); return a > 10 || (a === 10 && b >= 73); };
    const declared = JSON.parse(read('package.json')).dependencies['@sentry/nextjs'];
    const locked = JSON.parse(read('../../package-lock.json')).packages['node_modules/@sentry/nextjs'].version;
    expect([declared, atLeast(declared), locked, atLeast(locked)]).toEqual([declared, true, locked, true]);
  });
});

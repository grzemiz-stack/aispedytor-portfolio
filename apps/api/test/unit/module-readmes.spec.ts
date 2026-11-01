/**
 * Module READMEs stay in step with the code: every route of the module's
 * controller and every message code its files emit is described, and every
 * test file the README lists exists.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const API = resolve(__dirname, '../..');

interface ModuleSpec {
  dir: string;
  /** Files outside the module whose codes the module returns as its own. */
  sharedSources?: string[];
  /** README path relative to apps/api, when not `<dir>/README.md`. */
  readme?: string;
  /** The module has no controller / emits no codes — the README must say so. */
  noRoutes?: boolean;
  noCodes?: boolean;
  /** The module has no tests — the README must say so. */
  noTests?: boolean;
}

const MODULES: ModuleSpec[] = [
  { dir: 'src/ltl-matching', sharedSources: ['src/common/adr.ts', 'src/common/fx.ts', 'src/common/counterparty-risk.ts'] },
  { dir: 'src/trans-eu-auth', noCodes: true },
  { dir: 'src/analytics', noCodes: true },
  { dir: 'src/common', noRoutes: true },
  { dir: 'src/route-planner' },
  { dir: 'src/offers' },
  { dir: 'src/demands', noCodes: true },
  { dir: 'src/vehicles' },
  { dir: 'src/risk-analysis', noCodes: true },
  { dir: 'src/companies' },
  { dir: 'src/contractors' },
  { dir: 'src/email-agent' },
  { dir: 'src/ai-evaluation', noCodes: true },
  { dir: 'src/matching', sharedSources: ['src/common/adr.ts'] },
  { dir: 'src/geocoding', noRoutes: true, noCodes: true },
  { dir: 'src/prisma', readme: 'prisma/README.md', noRoutes: true, noCodes: true },
  { dir: 'src/users' },
  { dir: 'src/auth' },
  { dir: 'src/notifications', noCodes: true },
  { dir: 'src/health', noCodes: true },
  { dir: 'src/exchange-publisher' },
  { dir: 'src/tolls', noRoutes: true, noCodes: true },
  { dir: 'src/negotiation' },
  { dir: 'src/fleet-planning' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}

/**
 * Codes the module emits: `msg('CODE')`, and any other string literal in the
 * code that is a known message code — a code passed through a small helper
 * (`reject('PASSWORD_UNCHANGED')`, `coded(…, 'REGISTER_EMAIL_TAKEN')`) counts
 * too. Comments are left out.
 */
function emittedCodes(files: string[]): string[] {
  const known = new Set<string>(PLAN_MESSAGE_CODES);
  const codes = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of text.matchAll(/msg\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
    // The list of codes itself is not an emitter.
    if (f.endsWith('plan-messages.ts')) continue;
    for (const m of text.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) if (known.has(m[1])) codes.add(m[1]);
  }
  return [...codes].sort();
}

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const f of sourceFiles(dir).filter((p) => p.endsWith('.controller.ts'))) {
    const text = readFileSync(f, 'utf8');
    const base = text.match(/@Controller\('([^']*)'\)/)?.[1] ?? '';
    for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
      out.push(`${m[1].toUpperCase()} /api/${[base, m[2]].filter(Boolean).join('/')}`);
    }
  }
  return out;
}

describe.each(MODULES)('$dir', ({ dir, sharedSources = [], readme: readmeRel, noRoutes, noCodes, noTests }) => {
  const readmePath = resolve(API, readmeRel ?? join(dir, 'README.md'));
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

  it('exists', () => {
    expect(readme.length).toBeGreaterThan(0);
  });

  it('describes every route of the controller', () => {
    const r = routes(resolve(API, dir));
    // A module without routes must have none, and its README must say so.
    if (noRoutes) {
      expect(r).toEqual([]);
      expect(readme).toMatch(/## Endpoints\s+None/);
      return;
    }
    expect(r.length).toBeGreaterThan(0);
    expect(r.filter((route) => !readme.includes(`\`${route}`))).toEqual([]);
  });

  it('names every message code the module emits', () => {
    const codes = emittedCodes([...sourceFiles(resolve(API, dir)), ...sharedSources.map((s) => resolve(API, s))]);
    if (noCodes) {
      expect(codes).toEqual([]);
      expect(readme).toMatch(/## Message codes\s+None/);
      return;
    }
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((c) => !readme.includes(`\`${c}`))).toEqual([]);
  });

  it('lists only test files that exist', () => {
    const listed = [...readme.matchAll(/`((?:src|test)\/[\w./-]+\.(?:spec|int-spec)\.ts)`/g)].map((m) => m[1]);
    if (noTests) {
      expect(listed).toEqual([]);
      expect(readme).toMatch(/## Tests\s+None/);
      return;
    }
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((p) => !existsSync(resolve(API, p)))).toEqual([]);
  });
});

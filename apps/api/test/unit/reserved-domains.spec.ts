/**
 * Test data in reserved domains only (RFC 2606 / RFC 6761).
 *
 * The seed, tests, DTO examples and interface hints used addresses in real
 * domains (`spedytor.pl`, `firma.pl`, `b.pl`, `example.pl`…). Such domains may
 * belong to someone: a demo account or a Swagger example would point to
 * somebody else's mailbox. Allowed now: `example.com` / `.net` / `.org` (with
 * subdomains) and the `.test`, `.example`, `.invalid`, `.localhost` endings.
 * An exception only from the `EXCEPTIONS` list, with a reason.
 *
 * Also: the OSRM client introduces itself as AiSpedytor, not as another
 * product (it used to send `CargoEdge-AI/1.0`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SELF = relative(ROOT, __filename);

/** Reserved domains: example.com/.net/.org with subdomains, and the reserved endings. */
const RESERVED = /(^|\.)example\.(com|net|org)$|\.(test|example|invalid|localhost)$|^localhost$/i;

/** Addresses outside the reserved domains that are meant to stay — each with a reason. */
const EXCEPTIONS: Record<string, string> = {};

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', '.next', 'dist', 'migrations'].includes(e.name) ? [] : walk(p, keep);
    return keep(p) ? [p] : [];
  });
}

const ts = (p: string) => /\.tsx?$/.test(p);
/** Scope: the seed, tests (API and web), DTOs, web screens and components. */
function scope(): string[] {
  const api = join(ROOT, 'apps/api');
  const web = join(ROOT, 'apps/web/src');
  return [
    ...walk(join(api, 'prisma'), ts),
    ...walk(join(api, 'test'), ts),
    ...walk(join(api, 'src'), (p) => ts(p) && (/\.spec\.ts$/.test(p) || /\/dto\//.test(p))),
    ...walk(web, (p) => ts(p) && (/\.test\.tsx?$/.test(p) || /\/src\/(app|components)\//.test(p))),
  ].filter((p) => relative(ROOT, p) !== SELF);
}

function unreservedAddresses(text: string): string[] {
  return [...text.matchAll(EMAIL)].filter((m) => !RESERVED.test(m[1]) && !(m[0].toLowerCase() in EXCEPTIONS)).map((m) => m[0]);
}

describe('test data uses reserved domains only', () => {
  it('seed, tests, DTOs and web screens', () => {
    const files = scope();
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) => unreservedAddresses(line).map((a) => `${relative(ROOT, f)}:${i + 1} ${a}`)),
    );
    expect(hits).toEqual([]);
  });

  it('every exception has a reason', () => {
    for (const [address, reason] of Object.entries(EXCEPTIONS)) expect([address, reason.trim().length > 10]).toEqual([address, true]);
  });

  it('the OSRM client introduces itself as AiSpedytor', () => {
    const src = readFileSync(join(ROOT, 'apps/api/src/route-planner/osrm-calculator.service.ts'), 'utf8');
    // With the contact from NOMINATIM_CONTACT_EMAIL or without (the value is pinned by route-calculator-user-agent.spec.ts).
    expect(src).toMatch(/contact \? `AiSpedytor\/1\.0 \(\$\{contact\}\)` : 'AiSpedytor\/1\.0'/);
    expect(src).not.toMatch(/CargoEdge/i);
  });

  it('the check itself', () => {
    expect(unreservedAddresses('admin@spedytor.example.com a@b.example.com x@example.net contact@example.org u@host.test m@sentry.example z@example.invalid')).toEqual([]);
    expect(unreservedAddresses('a@b' + '.pl, admin@spedytor' + '.pl, x@example' + '.pl, y@example.com.pl')).toEqual([
      'a@b.pl', 'admin@spedytor.pl', 'x@example.pl', 'y@example.com.pl',
    ]);
  });
});

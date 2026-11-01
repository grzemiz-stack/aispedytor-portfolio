/**
 * `apps/api/.env.example` — after `cp .env.example .env` nothing pretends to
 * be a configured secret or key.
 *
 * A placeholder `ANTHROPIC_API_KEY=sk-ant-...` counted as a key: the service
 * logged "LLM classification enabled" and every e-mail went to Anthropic,
 * got a 401 and only then fell back to the rules. Empty = the rule-based
 * classifier at once.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { LlmClassifierService } from '../../src/email-agent/llm-classifier.service';

const env = parse(readFileSync(resolve(__dirname, '../../.env.example'), 'utf8'));

/** Keys whose value the user must provide — the example leaves them empty. */
const MUST_BE_EMPTY = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'ANTHROPIC_API_KEY', 'SENTRY_DSN', 'TRANS_EU_CLIENT_ID', 'TRANS_EU_CLIENT_SECRET', 'TRANS_EU_API_KEY'];

describe('.env.example', () => {
  it.each(MUST_BE_EMPTY)('%s is present and empty', (key) => {
    expect([key, env[key]]).toEqual([key, '']);
  });

  it('the example ANTHROPIC_API_KEY turns the LLM path off (rules at once)', () => {
    const config: any = { get: (k: string) => env[k] };
    expect(new LlmClassifierService(config).isAvailable).toBe(false);
  });
});

/**
 * Every key of the example is read in the code (`src/`) or in the Prisma
 * schema — otherwise the example promises a setting nothing listens to
 * (`JWT_REFRESH_EXPIRES_IN="7d"` was one, while the refresh token lifetime is
 * a fixed 7 days in auth.service.ts).
 * The exception is said in the file itself: `JWT_REFRESH_SECRET` ("Not used").
 */
describe('.env.example names only settings the code reads', () => {
  const NOT_READ_BY_DESIGN = ['JWT_REFRESH_SECRET'];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
  const code = [...files(resolve(__dirname, '../../src')), resolve(__dirname, '../../prisma/schema.prisma')]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  it.each(Object.keys(env).filter((k) => !NOT_READ_BY_DESIGN.includes(k)))('%s is read somewhere', (key) => {
    expect([key, new RegExp(`\\b${key}\\b`).test(code)]).toEqual([key, true]);
  });

  it('every variable the code reads is in the example (Trans.eu, API_BASE_URL and SENTRY_DSN were missing)', () => {
    const read = [...new Set([...code.matchAll(/process\.env\.([A-Z0-9_]+)|\.get(?:<[^>]+>)?\(['"]([A-Z0-9_]+)['"]/g)].map((m) => m[1] ?? m[2]))];
    expect(read.filter((k) => !(k in env)).sort()).toEqual([]);
  });

  it('the exception says so in the file', () => {
    expect(readFileSync(resolve(__dirname, '../../.env.example'), 'utf8')).toMatch(/# Not used[^\n]*\nJWT_REFRESH_SECRET=/);
  });
});

/**
 * docs/ARCHITECTURE.md tells the truth about what can be counted in the code.
 *
 * It used to promise "12 active models", subscription plans with AI limits,
 * e-mail alerts and a readiness probe — none of which the code has. The
 * numbers must match the schema and the source tree, and the promises the
 * code does not keep must not come back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const doc = readFileSync(resolve(__dirname, '../../../../docs/ARCHITECTURE.md'), 'utf8');
const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');

const count = (word: string) => (schema.match(new RegExp(`^${word} \\w+ \\{`, 'gm')) ?? []).length;

describe('docs/ARCHITECTURE.md', () => {
  it('model and enum counts = the Prisma schema', () => {
    const m = doc.match(/PostgreSQL \((\d+) models, (\d+) enums\)/);
    expect(m).not.toBeNull();
    expect([Number(m![1]), Number(m![2])]).toEqual([count('model'), count('enum')]);
  });

  it('backend module count = the directories of apps/api/src (without testing/)', () => {
    const m = doc.match(/## 4\. Backend Modules \((\d+) total\)/);
    const dirs = readdirSync(resolve(__dirname, '../../src'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'testing');
    expect(Number(m?.[1])).toBe(dirs.length);
  });

  it.each([
    ['subscription plans with AI limits', /subscription plans, AI usage limits/i],
    ['e-mail alerts', /email alerts/i],
    ['liveness/readiness probes', /Liveness \+ readiness/i],
  ])('does not promise %s', (_name, pattern) => {
    expect(doc).not.toMatch(pattern);
  });
});

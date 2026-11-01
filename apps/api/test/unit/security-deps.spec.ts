/**
 * Minimum versions of dependencies with security fixes
 * (docs/known-issues.md, "Dependency advisories").
 *
 * The lock decides what `npm ci` installs. `axios`, `proxy-addr` and
 * `form-data` were raised within the ranges package.json allows (no major
 * version change); `next` went up a major, 14 → 15.5 (docs/NEXT15-ESTIMATE.md).
 * The test keeps any later lock operation from taking them back below the
 * fixed version.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lock = JSON.parse(readFileSync(resolve(__dirname, '../../../../package-lock.json'), 'utf8'));
const packages: Record<string, { version: string }> = lock.packages;

/** package → lowest version without the `npm audit` advisories */
const MINIMUM: Record<string, string> = {
  axios: '1.20.0', // 6× high (prototype pollution, proxy bypass, among others)
  'proxy-addr': '2.0.8', // critical: IP spoofing via IPv4-mapped IPv6
  'form-data': '4.0.6', // high; required by axios 1.20
  next: '15.5.24', // critical: RCE (Windows, AVIF in the image optimizer); the RSC group (DoS, cache poisoning) — Next 15.5
};

const parse = (v: string) => v.split('.').map(Number);
const atLeast = (v: string, min: string) => {
  const [a, b] = [parse(v), parse(min)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe('dependencies with security fixes', () => {
  it.each(Object.entries(MINIMUM))('%s: every copy in the lock is ≥ %s', (name, min) => {
    const copies = Object.entries(packages).filter(([key]) => key.endsWith(`node_modules/${name}`));
    expect(copies.length).toBeGreaterThan(0);
    for (const [key, entry] of copies) expect([key, atLeast(entry.version, min)]).toEqual([key, true]);
  });

  it('compares versions as numbers, not as text', () => {
    expect([atLeast('1.20.0', '1.9.0'), atLeast('1.9.0', '1.20.0'), atLeast('2.0.8', '2.0.8')]).toEqual([true, false, true]);
  });
});

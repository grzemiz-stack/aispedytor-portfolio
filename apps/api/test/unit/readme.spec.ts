/**
 * The main README states what a buyer must know: how to plug in a toll
 * provider (without naming any provider's keys), what is out of scope, and
 * links that resolve. Docs do not point at commits of a history this
 * repository does not have.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

function section(title: string): string {
  const start = readme.indexOf(`\n## ${title}\n`);
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

describe('Tolls — plugging in a provider', () => {
  const tolls = section('Tolls — plugging in a provider');

  it('names the contract, the single registration point and how to run the contract tests', () => {
    expect(tolls).toContain('apps/api/src/tolls/toll-provider.ts');
    expect(tolls).toContain('apps/api/src/tolls/tolls.module.ts');
    expect(tolls).toContain('{ provide: TOLL_PROVIDER, useClass: MyTollProvider }');
    expect(tolls).toContain('runTollProviderContract(');
    expect(tolls).toContain('cd apps/api && npx jest test/contract');
    expect(tolls).toContain('TOLL_PROVIDER_NOT_CONFIGURED');
    expect(tolls).toContain('502 TOLL_PROVIDER_UNAVAILABLE');
  });

  it('names no provider keys or products', () => {
    expect(tolls).not.toMatch(/[A-Z][A-Z0-9]*_(API_)?KEY|SECRET|TOKEN/);
    expect(tolls).not.toMatch(/\bHERE\b|TollGuru|PTV/);
  });

  it('the module still holds the default registration (useValue: null) that the README tells you to replace', () => {
    const module = readFileSync(resolve(root, 'apps/api/src/tolls/tolls.module.ts'), 'utf8');
    expect(module).toContain('{ provide: TOLL_PROVIDER, useValue: null }');
  });

  it('the contract helper it imports exists with that name', () => {
    const contract = readFileSync(resolve(root, 'apps/api/test/contract/toll-provider.contract.ts'), 'utf8');
    expect(contract).toMatch(/export function runTollProviderContract\(/);
  });
});

it('quick start: secrets, then schema, then the Prisma client, then the seed', () => {
  // A fresh clone has no generated client; `migrate deploy` does not create it.
  const quick = section('Quick start');
  const at = (s: string) => {
    const i = quick.indexOf(s);
    expect([s, i > -1]).toEqual([s, true]);
    return i;
  };
  const order = ['npm ci', 'openssl rand -hex 32', 'npm run db:migrate:deploy', 'npm run db:generate', 'npm run db:seed', 'npm run dev'].map(at);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

it('says plans, limits and billing are out of scope', () => {
  expect(section('Scope')).toMatch(/\*\*plans, usage limits and billing\*\*/);
});

it('relative links resolve', () => {
  const links = [...readme.matchAll(/\]\(((?!https?:)[^)#]+)(#[^)]*)?\)/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThanOrEqual(5);
  expect(links.filter((l) => !existsSync(resolve(root, l)))).toEqual([]);
});

it('docs do not cite commits', () => {
  for (const file of ['README.md', 'docs/ARCHITECTURE.md', 'docs/decisions.md', 'docs/known-issues.md', 'docs/DEPLOYMENT.md']) {
    expect([file, readFileSync(resolve(root, file), 'utf8').match(/commit `?[0-9a-f]{7,40}\b/g)]).toEqual([file, null]);
  }
});

/**
 * The seed runs only with an explicit NODE_ENV=development|test (prisma/seed-guard.ts).
 *
 * The seed creates demo accounts with known passwords (README "Demo accounts").
 * With no NODE_ENV, production, staging or any other name it refuses. The test
 * runs the real `prisma/seed.ts` in a separate process against a database
 * that does not exist (port 1): when refused, the process exits with code 1
 * before it tries to connect to the database or read the encryption key.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedRefusal } from '../../prisma/seed-guard';

const API_DIR = resolve(__dirname, '../..');
const SEED = resolve(API_DIR, 'prisma/seed.ts');
const TSX_CLI = require.resolve('tsx/cli');

/** Empty values instead of missing ones — `dotenv` will not override them from a local `.env`. */
function runSeed(nodeEnv: string) {
  const r = spawnSync(process.execPath, [TSX_CLI, SEED], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
      ENCRYPTION_KEY: '',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('seedRefusal', () => {
  it.each(['production', 'Production', ' production ', 'staging', 'prod'])('refuses for NODE_ENV=%p', v => {
    expect(seedRefusal({ NODE_ENV: v })).toMatch(new RegExp(`^Seed refuses: NODE_ENV=${v.trim()}\\. The seed runs only with NODE_ENV=development or test`));
  });

  it.each([undefined, '', '  '])('refuses without NODE_ENV (%p) and says it is not set', v => {
    expect(seedRefusal({ NODE_ENV: v })).toMatch(/^Seed refuses: NODE_ENV is not set\. The seed runs only with NODE_ENV=development or test/);
  });

  it.each(['development', 'test', ' Test ', 'DEVELOPMENT'])('allows NODE_ENV=%p', v => {
    expect(seedRefusal({ NODE_ENV: v })).toBeNull();
  });
});

describe('prisma/seed.ts as a process', () => {
  // An empty NODE_ENV instead of a missing one: `dotenv` will not override it
  // from a local `.env` (usually development there) — empty = not set for the guard.
  it.each([['production', /NODE_ENV=production\./], ['staging', /NODE_ENV=staging\./], ['', /NODE_ENV is not set\./]])(
    'NODE_ENV=%p: exit 1 with the refusal, before the database or the encryption key',
    (nodeEnv, why) => {
      const r = runSeed(nodeEnv);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/Seed refuses/);
      expect(r.out).toMatch(why);
      // It reached neither the key (empty → key error) nor the database (port 1 → connection error).
      expect(r.out).not.toMatch(/ENCRYPTION_KEY|Can't reach database|P1001|ECONNREFUSED/);
    },
  );

  it.each(['development', 'test'])('%s: passes the guard (then stops on the empty encryption key, as before)', nodeEnv => {
    const r = runSeed(nodeEnv);
    expect(r.status).not.toBe(0);
    expect(r.out).not.toMatch(/Seed refuses/);
    expect(r.out).toMatch(/ENCRYPTION_KEY/);
  });

  it('the guard is the first statement before the Prisma client and the key', () => {
    const src = readFileSync(SEED, 'utf8');
    const guard = src.indexOf('refuseSeedOutsideDevOrTest();');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf('new PrismaClient()'));
    expect(guard).toBeLessThan(src.indexOf('requireEncryptionKey(process.env.ENCRYPTION_KEY)'));
  });
});

it('README says the demo accounts are test data and the seed runs only in development/test', () => {
  const readme = readFileSync(resolve(API_DIR, '../../README.md'), 'utf8');
  expect(readme).toMatch(/\*\*These are test data\.\*\*/);
  expect(readme).toMatch(/The seed \*\*runs only with an explicit\s+`NODE_ENV=development` or `test`\*\*/);
});

it('every seed run in tools/ sets NODE_ENV=test explicitly', () => {
  const demo = readFileSync(resolve(API_DIR, '../../tools/demo-test.sh'), 'utf8');
  const runs = demo.split('\n').filter((l) => /prisma db seed/.test(l) && !l.trim().startsWith('#'));
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.filter((l) => !/NODE_ENV=test /.test(l))).toEqual([]);
});

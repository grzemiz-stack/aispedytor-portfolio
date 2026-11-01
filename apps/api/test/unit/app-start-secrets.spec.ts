/**
 * Application start and secrets.
 *
 * `ConfigModule.forRoot({ validate: validateEnv })` is asynchronous in this
 * version: a bad secret is a rejected promise, not an exception at import —
 * inside the Jest process it would kill the whole test run. So the start is
 * checked for real: in a SEPARATE process (tsx loads src/app.module from
 * apps/api — the tsconfig with decorators is there). A "missing" secret is an
 * empty value: process.env takes precedence over the local .env, so the .env
 * cannot supply a real secret. Also checked by hand on `node dist/main.js`
 * (outside the repository): exit code 1 and the same message.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { secretProblems, validateEnv } from '../../src/common/config/secrets';
import { EncryptionService } from '../../src/common/encryption/encryption.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';

const API_DIR = resolve(__dirname, '../..');
const APP_MODULE = resolve(API_DIR, 'src/app.module');
const TSX_CLI = require.resolve('tsx/cli');
const GOOD = { JWT_SECRET: 'x'.repeat(48), ENCRYPTION_KEY: 'ab'.repeat(32) };

/** Values exactly as in apps/api/.env.example (KEY="value"). */
function envExample(): Record<string, string> {
  const text = readFileSync(resolve(API_DIR, '.env.example'), 'utf8');
  return Object.fromEntries(
    [...text.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map(m => [m[1], m[2]]),
  );
}

function start(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? '', JWT_SECRET: '', ENCRYPTION_KEY: '' };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync(process.execPath, [TSX_CLI, '-e', `require(${JSON.stringify(APP_MODULE)}); setTimeout(() => console.log('LOADED'), 300)`], {
    cwd: API_DIR, env: clean, encoding: 'utf8', timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('app start — secrets without fallbacks (child process)', () => {
  jest.setTimeout(120_000);

  it('valid secrets → AppModule loads and stays up', () => {
    const r = start(GOOD);
    expect(r.out).not.toMatch(/Unsafe configuration/);
    expect(r.code).toBe(0);
    expect(r.out).toContain('LOADED');
  });

  it('no secrets at all → exit ≠ 0, both named', () => {
    const r = start({});
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/JWT_SECRET is not set[\s\S]*ENCRYPTION_KEY is not set/);
  });

  it('the values shipped in .env.example → exit ≠ 0 with a readable message', () => {
    const r = start(envExample());
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Unsafe configuration — the application does not start');
    expect(r.out).toMatch(/JWT_SECRET is not set[\s\S]*ENCRYPTION_KEY is not set[\s\S]*openssl rand -hex 32/);
  });

  it('the old fallback values (fallback-secret, all-zero key) → exit ≠ 0', () => {
    const r = start({ JWT_SECRET: 'fallback-secret', ENCRYPTION_KEY: '0'.repeat(64) });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/placeholder value[\s\S]*zeros only/);
  });
});

describe('setup files: no placeholders, secrets generated', () => {
  const ROOT = resolve(API_DIR, '../..');

  it('.env.example ships the secrets empty, with the generation command, and no placeholder', () => {
    const env = envExample();
    expect(env.JWT_SECRET).toBe('');
    expect(env.ENCRYPTION_KEY).toBe('');
    expect(env.JWT_REFRESH_SECRET).toBe('');
    const text = readFileSync(resolve(API_DIR, '.env.example'), 'utf8');
    expect(text).toContain('openssl rand -hex 32');
    // Values (not comments): no placeholder and no all-zero key.
    expect(Object.values(env).filter(v => /change-this|^0{64}$|fallback-secret/i.test(v))).toEqual([]);
  });

  it('README quick start generates the secrets before migrate and seed', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const gen = readme.indexOf('openssl rand -hex 32');
    expect(gen).toBeGreaterThan(-1);
    expect(gen).toBeLessThan(readme.indexOf('npm run db:migrate'));
    expect(gen).toBeLessThan(readme.indexOf('npm run db:seed'));
  });

  it('CI and the Docker demo test generate random secrets per run (none stored in the repo)', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/bramka.yml'), 'utf8');
    expect(ci).toMatch(/JWT_SECRET="\$\(openssl rand -hex 32\)"/);
    expect(ci).toMatch(/ENCRYPTION_KEY="\$\(openssl rand -hex 32\)"/);
    expect(ci).toContain('GITHUB_ENV');
    expect(ci.indexOf('name: sekrety na przebieg')).toBeLessThan(ci.indexOf('name: tools/bramka.sh'));
    const demo = readFileSync(resolve(ROOT, 'tools/demo-test.sh'), 'utf8');
    expect(demo).toMatch(/ENCRYPTION_KEY="\$\{ENCRYPTION_KEY:-\$\(openssl rand -hex 32\)\}"/);
  });
});

describe('secret rules', () => {
  it.each([
    [{ JWT_SECRET: '', ENCRYPTION_KEY: GOOD.ENCRYPTION_KEY }, ['JWT_SECRET is not set']],
    [{ JWT_SECRET: 'change-this-to-a-long-random-secret', ENCRYPTION_KEY: GOOD.ENCRYPTION_KEY }, ['JWT_SECRET is a placeholder value, not a secret']],
    [{ JWT_SECRET: 'x'.repeat(31), ENCRYPTION_KEY: GOOD.ENCRYPTION_KEY }, ['JWT_SECRET is shorter than 32 characters']],
    [{ JWT_SECRET: GOOD.JWT_SECRET, ENCRYPTION_KEY: 'xyz' }, ['ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)']],
    [{ JWT_SECRET: GOOD.JWT_SECRET, ENCRYPTION_KEY: '0'.repeat(64) }, ['ENCRYPTION_KEY made of zeros only is not a key']],
    [GOOD, []],
  ])('%p → %p', (env, problems) => {
    expect(secretProblems(env)).toEqual(problems);
  });

  it('validateEnv throws with the generation hint, passes valid env through', () => {
    expect(() => validateEnv({})).toThrow(/openssl rand -hex 32/);
    expect(validateEnv({ ...GOOD, OTHER: '1' })).toEqual({ ...GOOD, OTHER: '1' });
  });
});

describe('services refuse a missing or unsafe secret on their own', () => {
  const config = (v: Record<string, string | undefined>) => ({ get: (k: string) => v[k] }) as any;

  it.each([[undefined], [''], ['0'.repeat(64)]])('EncryptionService with ENCRYPTION_KEY %p → throws', key => {
    expect(() => new EncryptionService(config({ ENCRYPTION_KEY: key }))).toThrow(/ENCRYPTION_KEY/);
  });

  it('EncryptionService with a real key encrypts and decrypts', () => {
    const enc = new EncryptionService(config({ ENCRYPTION_KEY: 'ab'.repeat(32) }));
    expect(enc.decrypt(enc.encrypt('jan@example.net'))).toBe('jan@example.net');
  });

  it.each([[undefined], ['fallback-secret']])('JwtStrategy with JWT_SECRET %p → throws', secret => {
    expect(() => new JwtStrategy(config({ JWT_SECRET: secret }), {} as any)).toThrow(/JWT_SECRET/);
  });
});

describe('no fallback secret left in the source', () => {
  // Application code and seed (not tests — those use bad values on purpose).
  const hits = (pattern: string) =>
    execSync(`grep -rnE ${JSON.stringify(pattern)} src prisma || true`, { cwd: API_DIR, encoding: 'utf8' })
      .split('\n').filter((l: string) => l && !l.includes('common/config/secrets.ts'));

  it("no 'fallback-secret'", () => {
    expect(hits('fallback-secret')).toEqual([]);
  });

  it("no all-zero key ('0'.repeat(64) or 64 zeros)", () => {
    expect(hits("'0'\\.repeat\\(64\\)|0{64}")).toEqual([]);
  });
});

/**
 * Company registration — off by default.
 *
 * `POST /auth/register` creates a company with its ADMIN, with no invitation.
 * It works only with an explicit `NODE_ENV=development|test` or
 * `REGISTRATION_ENABLED=true`; no `NODE_ENV` = off (a server nobody set an
 * environment for is not open). Off → 403 REGISTRATION_DISABLED before
 * anything touches the database — the guard runs before validation, so the
 * answer does not depend on the body. The first company on a server is
 * created by `company:create` (tested in `create-company-cli.spec.ts`).
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { registrationEnabled, RegistrationEnabledGuard } from '../../src/common/config/registration';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

describe('registrationEnabled', () => {
  it.each([
    [{}, false],
    [{ NODE_ENV: '' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'staging' }, false],
    [{ NODE_ENV: 'prod' }, false],
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: ' Development ' }, true],
    [{ NODE_ENV: 'test' }, true],
    [{ REGISTRATION_ENABLED: 'true' }, true],
    [{ NODE_ENV: 'production', REGISTRATION_ENABLED: 'TRUE' }, true],
    [{ NODE_ENV: 'production', REGISTRATION_ENABLED: '1' }, false],
    [{ NODE_ENV: 'production', REGISTRATION_ENABLED: 'yes' }, false],
    [{ NODE_ENV: 'production', REGISTRATION_ENABLED: 'false' }, false],
  ])('%j → %s', (env, expected) => {
    expect(registrationEnabled(env)).toBe(expected);
  });
});

describe('POST /auth/register over HTTP', () => {
  let app: INestApplication;
  const registerCompany = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r', userId: 'u-1', companyId: 'c-1' }));
  const saved = { NODE_ENV: process.env.NODE_ENV, REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED };
  const BODY = { companyName: 'Firma', taxId: '5260250274', email: 'jan@firma.example.com', firstName: 'Jan', lastName: 'Kowalski', password: 'Correct-horse-1' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [AuthController], providers: [{ provide: AuthService, useValue: { registerCompany } }] }).compile();
    app = mod.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    Object.assign(process.env, saved);
    if (saved.REGISTRATION_ENABLED === undefined) delete process.env.REGISTRATION_ENABLED;
  });
  beforeEach(() => registerCompany.mockClear());

  const post = async (env: Record<string, string | undefined>, body: object = BODY) => {
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const res = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('no NODE_ENV → 403 REGISTRATION_DISABLED, the service is never called', async () => {
    const r = await post({ NODE_ENV: undefined, REGISTRATION_ENABLED: undefined });
    expect([r.status, r.body.code, registerCompany.mock.calls.length]).toEqual([403, 'REGISTRATION_DISABLED', 0]);
  });

  it('production → 403 also for an invalid body (the guard runs before validation)', async () => {
    const r = await post({ NODE_ENV: 'production', REGISTRATION_ENABLED: undefined }, { nonsense: 1 });
    expect([r.status, r.body.code]).toEqual([403, 'REGISTRATION_DISABLED']);
  });

  it('production with REGISTRATION_ENABLED=true → registers', async () => {
    const r = await post({ NODE_ENV: 'production', REGISTRATION_ENABLED: 'true' });
    expect([r.status, r.body.companyId, registerCompany.mock.calls.length]).toEqual([201, 'c-1', 1]);
  });

  it('development → registers', async () => {
    const r = await post({ NODE_ENV: 'development', REGISTRATION_ENABLED: undefined });
    expect(r.status).toBe(201);
  });
});

it('the guard is on the register route only', () => {
  const guards = (name: keyof AuthController) => Reflect.getMetadata('__guards__', AuthController.prototype[name]) ?? [];
  expect([guards('register'), guards('login'), guards('refresh')]).toEqual([[RegistrationEnabledGuard], [], []]);
});

it('REGISTRATION_DISABLED is in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toContain('REGISTRATION_DISABLED');
});

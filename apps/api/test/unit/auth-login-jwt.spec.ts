/**
 * Login, the JWT strategy and token lifetimes.
 *
 * Switching off the password check or `isActive`, `ignoreExpiration: true`,
 * taking the company and role from the token instead of the database, a TTL
 * of 7 days instead of 15 minutes, a logout that deletes everyone's tokens —
 * each of these used to pass with the tests green. Here every rule has its test.
 */
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
const SECRET = 'cd'.repeat(32);
const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) };
const PASSWORD = 'Correct-horse-1';

async function setup(over: Partial<{ isActive: boolean }> = {}) {
  const user = {
    id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: over.isActive ?? true,
    emailHash: enc.hash('jan@example.net'), passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailEncrypted: enc.encrypt('jan@example.net'), firstNameEncrypted: enc.encrypt('Jan'), lastNameEncrypted: enc.encrypt('Kowalski'),
  };
  const created: any[] = [];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (where.emailHash === user.emailHash ? user : null)),
      update: jest.fn(async () => user),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => { created.push(data); return data; }),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return { service: new AuthService(prisma, new JwtService({}), config, enc), prisma, created };
}

describe('login', () => {
  it('right password → a pair of tokens for the user\'s company and role', async () => {
    const { service } = await setup();
    const r = await service.login({ email: 'jan@example.net', password: PASSWORD } as any);
    const payload: any = new JwtService({}).verify(r.accessToken, { secret: SECRET });
    expect([payload.sub, payload.companyId, payload.role, r.user.companyId]).toEqual(['u-1', 'comp-1', 'DISPATCHER', 'comp-1']);
  });

  it('wrong password → 401, no tokens', async () => {
    const { service, prisma } = await setup();
    await expect(service.login({ email: 'jan@example.net', password: 'wrong-password-1' } as any)).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('unknown e-mail → 401', async () => {
    const { service } = await setup();
    await expect(service.login({ email: 'nobody@example.net', password: PASSWORD } as any)).rejects.toMatchObject({ status: 401 });
  });

  it('inactive account with the right password → 401, no tokens', async () => {
    const { service, prisma } = await setup({ isActive: false });
    await expect(service.login({ email: 'jan@example.net', password: PASSWORD } as any)).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('token lifetimes', () => {
  it('the access token lives 15 minutes', async () => {
    const { service } = await setup();
    const r = await service.login({ email: 'jan@example.net', password: PASSWORD } as any);
    const p: any = new JwtService({}).decode(r.accessToken);
    expect(p.exp - p.iat).toBe(15 * 60);
  });

  it('the refresh token is stored with a 7-day expiry', async () => {
    const { service, created } = await setup();
    const before = Date.now();
    await service.login({ email: 'jan@example.net', password: PASSWORD } as any);
    const days = (created[0].expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });
});

describe('refresh', () => {
  function refreshSetup(expiresAt: Date) {
    const stored = { id: 'rt-1', tokenHash: hashRefreshToken('r-1'), expiresAt, user: { id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: true, emailEncrypted: enc.encrypt('jan@example.net') } };
    const prisma: any = {
      refreshToken: {
        findUnique: jest.fn(async ({ where }: any) => (where.tokenHash === stored.tokenHash ? stored : null)),
        delete: jest.fn(async () => stored),
        create: jest.fn(async () => ({})),
      },
    };
    return { service: new AuthService(prisma, new JwtService({}), config, enc), prisma };
  }

  it('an expired refresh token → 403, deleted, no new pair', async () => {
    const { service, prisma } = refreshSetup(new Date(Date.now() - 1000));
    await expect(service.refresh('r-1')).rejects.toMatchObject({ status: 403 });
    expect([prisma.refreshToken.delete.mock.calls[0][0], prisma.refreshToken.create.mock.calls.length]).toEqual([{ where: { id: 'rt-1' } }, 0]);
  });

  it('an unknown refresh token → 403', async () => {
    const { service } = refreshSetup(new Date(Date.now() + 86_400_000));
    await expect(service.refresh('other')).rejects.toMatchObject({ status: 403 });
  });
});

describe('logout', () => {
  it('deletes the refresh tokens of this user only', async () => {
    const { service, prisma } = await setup();
    await service.logout('u-1');
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
  });
});

describe('JwtStrategy', () => {
  function strategy(rows: any[]) {
    const findFirst = jest.fn(async ({ where }: any) => rows.find((u) => u.id === where.id && (where.isActive === undefined || u.isActive === where.isActive)) ?? null);
    return { s: new JwtStrategy(config, { user: { findFirst } } as any), findFirst };
  }

  it('the company and role come from the database, not from the token', async () => {
    const { s } = strategy([{ id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: true }]);
    const r = await s.validate({ sub: 'u-1', companyId: 'comp-OTHER', role: 'ADMIN', email: 'jan@example.net' });
    expect([r.companyId, r.role, r.userId]).toEqual(['comp-1', 'DISPATCHER', 'u-1']);
  });

  it('a deactivated user → 401 even with a valid token', async () => {
    const { s, findFirst } = strategy([{ id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: false }]);
    await expect(s.validate({ sub: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', email: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'u-1', isActive: true });
  });

  it('expired tokens are not accepted (ignoreExpiration is off)', () => {
    const { s } = strategy([]);
    expect((s as any)._verifOpts?.ignoreExpiration ?? (s as any)._jwtOptions?.ignoreExpiration).toBe(false);
  });
});

/**
 * Refresh tokens — the family and reuse detection.
 *
 * Before: rotation deleted the used token, so using it again looked like an
 * unknown token (403) — the family lived on. Whoever stole a refresh token
 * (localStorage) rotated it forever, while the rightful user only got 403.
 * Two concurrent refreshes with the same token ended in 500 (the second
 * `delete` found no row).
 *
 * Now: every login starts a family (`familyId`); a refresh marks the used
 * token (`usedAt`, conditionally — exactly one request wins) and issues the
 * next one in the same family. Using an already used token = theft or a
 * replay: the whole family is deleted, 403, a warning in the log. Other
 * families (other logins) are untouched.
 */
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
const SECRET = 'cd'.repeat(32);
const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) };
const PASSWORD = 'Correct-horse-1';

type Row = { id: string; tokenHash: string; userId: string; familyId: string; usedAt: Date | null; expiresAt: Date; createdAt: Date };

async function setup() {
  const user = {
    id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: true,
    emailHash: enc.hash('jan@example.net'), passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailEncrypted: enc.encrypt('jan@example.net'), firstNameEncrypted: enc.encrypt('Jan'), lastNameEncrypted: enc.encrypt('Kowalski'),
  };
  let rows: Row[] = [];
  let seq = 0;
  const matches = (r: Row, where: any) => Object.entries(where).every(([k, v]) => (r as any)[k] === v);
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (where.emailHash === user.emailHash ? user : null)),
      findFirst: jest.fn(async () => user),
      update: jest.fn(async () => user),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => { const r = { id: `rt-${++seq}`, usedAt: null, createdAt: new Date(), ...data }; rows.push(r); return r; }),
      findUnique: jest.fn(async ({ where }: any) => { const r = rows.find((x) => x.tokenHash === where.tokenHash); return r ? { ...r, user } : null; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      deleteMany: jest.fn(async ({ where }: any) => { const before = rows.length; rows = rows.filter((r) => !matches(r, where)); return { count: before - rows.length }; }),
      delete: jest.fn(async ({ where }: any) => { const r = rows.find((x) => x.id === where.id); if (!r) throw new Error('P2025 record not found'); rows = rows.filter((x) => x !== r); return r; }),
    },
  };
  const service = new AuthService(prisma, new JwtService({}), config, enc);
  const login = () => service.login({ email: 'jan@example.net', password: PASSWORD } as any);
  return { service, prisma, login, rows: () => rows };
}

const byToken = (rows: Row[], token: string) => rows.find((r) => r.tokenHash === hashRefreshToken(token))!;
const familyOf = (rows: Row[], token: string) => byToken(rows, token).familyId;

describe('one family per login', () => {
  it('refresh: a new token in the same family; the used one stays, marked used', async () => {
    const { service, login, rows } = await setup();
    const { refreshToken: r1 } = await login();
    const { refreshToken: r2 } = await service.refresh(r1);
    expect(r2).not.toBe(r1);
    expect(familyOf(rows(), r2)).toBe(familyOf(rows(), r1));
    expect([byToken(rows(), r1).usedAt instanceof Date, byToken(rows(), r2).usedAt]).toEqual([true, null]);
  });

  it('each login starts its own family', async () => {
    const { login, rows } = await setup();
    const a = await login();
    const b = await login();
    expect(familyOf(rows(), a.refreshToken)).not.toBe(familyOf(rows(), b.refreshToken));
  });

  it('the refresh token is 32 random bytes (base64url)', async () => {
    const { login } = await setup();
    const { refreshToken } = await login();
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});

describe('reuse of a used token', () => {
  it('→ 403, the whole family deleted (also the newest token), a warning logged', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, login, rows } = await setup();
    const { refreshToken: r1 } = await login();
    const { refreshToken: r2 } = await service.refresh(r1);
    await expect(service.refresh(r1)).rejects.toMatchObject({ status: 403 });
    expect(rows()).toEqual([]);
    await expect(service.refresh(r2)).rejects.toMatchObject({ status: 403 });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/reuse.*u-1/i)]);
    warn.mockRestore();
  });

  it('another login (another family) of the same user survives', async () => {
    const { service, login, rows } = await setup();
    const phone = await login();
    const laptop = await login();
    await service.refresh(phone.refreshToken);
    await expect(service.refresh(phone.refreshToken)).rejects.toMatchObject({ status: 403 });
    expect(rows().map((r) => r.tokenHash)).toEqual([hashRefreshToken(laptop.refreshToken)]);
    await expect(service.refresh(laptop.refreshToken)).resolves.toHaveProperty('refreshToken');
  });

  it('two refreshes with the same token at once: one new pair, the other 403 (not 500); the family is revoked', async () => {
    const { service, login, rows } = await setup();
    const { refreshToken: r1 } = await login();
    const results = await Promise.allSettled([service.refresh(r1), service.refresh(r1)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 403 });
    expect(rows()).toEqual([]);
  });
});

describe('unchanged rules', () => {
  it('an expired token → 403, no new pair', async () => {
    const { service, login, rows, prisma } = await setup();
    const { refreshToken } = await login();
    rows()[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 403 });
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('logout deletes every family of the user', async () => {
    const { service, login, rows } = await setup();
    await login();
    await login();
    await service.logout('u-1');
    expect(rows()).toEqual([]);
  });
});

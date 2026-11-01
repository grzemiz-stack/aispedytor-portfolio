/**
 * Refresh tokens in the database as SHA-256.
 *
 * Before: `refresh_tokens.token` held the token in plain text — whoever read
 * the database or a copy of it (a backup, a dump for analysis) could refresh
 * users' sessions for 7 days. Now the database keeps only the SHA-256 (hex) of
 * the token in `token_hash`; the client gets the token, the server looks it up
 * by its hash. The hash from the database is not a token — given to
 * /auth/refresh it answers 403. The token is 32 random bytes, so a plain
 * SHA-256 (no salt) is enough: there is nothing to guess from a dictionary.
 */
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? 'cd'.repeat(32) : undefined) };
const PASSWORD = 'Correct-horse-1';

async function setup() {
  const user = {
    id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive: true,
    emailHash: enc.hash('jan@example.net'), passwordHash: await bcrypt.hash(PASSWORD, 4),
    emailEncrypted: enc.encrypt('jan@example.net'), firstNameEncrypted: enc.encrypt('Jan'), lastNameEncrypted: enc.encrypt('Kowalski'),
  };
  const rows: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn(async () => user), update: jest.fn(async () => user) },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => { const r = { id: `rt-${rows.length + 1}`, usedAt: null, ...data }; rows.push(r); return r; }),
      findUnique: jest.fn(async ({ where }: any) => { const r = rows.find((x) => x.tokenHash === where.tokenHash); return r ? { ...r, user } : null; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id && x.usedAt === null); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      delete: jest.fn(async () => ({})),
    },
  };
  const service = new AuthService(prisma, new JwtService({}), config, enc);
  return { service, prisma, rows, login: () => service.login({ email: 'jan@example.net', password: PASSWORD } as any) };
}

it('hashRefreshToken = SHA-256, hex (the known vector for "abc")', () => {
  expect(hashRefreshToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

it('the database gets only the hash: no field of the saved row holds the token', async () => {
  const { prisma, login } = await setup();
  const { refreshToken } = await login();
  const data = prisma.refreshToken.create.mock.calls[0][0].data;
  expect(data.tokenHash).toBe(createHash('sha256').update(refreshToken).digest('hex'));
  expect(JSON.stringify(data)).not.toContain(refreshToken);
  expect(data).not.toHaveProperty('token');
});

it('refresh looks the token up by its hash and works', async () => {
  const { service, prisma, login } = await setup();
  const { refreshToken } = await login();
  await expect(service.refresh(refreshToken)).resolves.toHaveProperty('refreshToken');
  expect(prisma.refreshToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashRefreshToken(refreshToken) });
});

it('the hash read from the database is not a token: /auth/refresh with it → 403', async () => {
  const { service, rows, login } = await setup();
  await login();
  await expect(service.refresh(rows[0].tokenHash)).rejects.toMatchObject({ status: 403 });
});

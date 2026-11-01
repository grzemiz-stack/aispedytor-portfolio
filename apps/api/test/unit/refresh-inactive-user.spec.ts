/**
 * POST /auth/refresh for a deactivated account: 403 as for an invalid token,
 * the token is deleted and no new pair is issued (otherwise a deactivated user
 * could keep refreshing for up to 7 days).
 */
import { JwtService } from '@nestjs/jwt';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
const SECRET = 'cd'.repeat(32);

function setup(isActive: boolean) {
  const stored = {
    id: 'rt-1', tokenHash: hashRefreshToken('refresh-abc'), expiresAt: new Date(Date.now() + 86_400_000), familyId: 'fam-1', usedAt: null,
    user: { id: 'u-1', companyId: 'comp-1', role: 'DISPATCHER', isActive, emailEncrypted: enc.encrypt('jan@example.net') },
  };
  const prisma: any = {
    refreshToken: {
      findUnique: jest.fn(async ({ where }: any) => (where.tokenHash === stored.tokenHash ? stored : null)),
      delete: jest.fn(async () => stored),
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => ({})),
    },
  };
  const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) };
  return { service: new AuthService(prisma, new JwtService({}), config, enc), prisma };
}

it('inactive user → 403, the token is deleted, no new pair', async () => {
  const { service, prisma } = setup(false);

  await expect(service.refresh('refresh-abc')).rejects.toMatchObject({ status: 403 });
  expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
  expect(prisma.refreshToken.create).not.toHaveBeenCalled();
});

it('active user → a new pair in the same family, the old token marked used (not deleted)', async () => {
  const { service, prisma } = setup(true);

  const r = await service.refresh('refresh-abc');
  expect(r.accessToken).toBeTruthy();
  expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { id: 'rt-1', usedAt: null }, data: { usedAt: expect.any(Date) } });
  expect(prisma.refreshToken.delete).not.toHaveBeenCalled();
  expect(prisma.refreshToken.create.mock.calls[0][0].data.familyId).toBe('fam-1');
});

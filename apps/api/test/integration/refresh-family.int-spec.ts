/**
 * The refresh token family on a real PostgreSQL.
 *
 * The database from tools/demo-test.sh: migrations (with `family_id` and
 * `used_at`) and the seed — login with the demo ADMIN account. Checks what a
 * fake cannot show: that the conditional marking of the used token
 * (`updateMany` with `usedAt: null`) lets exactly one of two concurrent
 * refreshes through in the database itself, and the other ends in 403, not 500.
 */
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const prisma = new PrismaClient();
const env: any = { get: (k: string) => process.env[k] };
const auth = new AuthService(prisma as any, new JwtService({}), env, new EncryptionService(env));
const login = () => auth.login({ email: 'admin@spedytor.example.com', password: 'Admin1234!' } as any);
const row = (token: string) => prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });

afterAll(() => prisma.$disconnect());

it('rotation keeps the family and marks the used token; its reuse deletes the family', async () => {
  const { refreshToken: r1 } = await login();
  const { refreshToken: r2 } = await auth.refresh(r1);
  const [a, b] = [await row(r1), await row(r2)];
  expect([a!.familyId === b!.familyId, a!.usedAt instanceof Date, b!.usedAt]).toEqual([true, true, null]);

  await expect(auth.refresh(r1)).rejects.toMatchObject({ status: 403 });
  expect(await prisma.refreshToken.count({ where: { familyId: a!.familyId } })).toBe(0);
  await expect(auth.refresh(r2)).rejects.toMatchObject({ status: 403 });
});

it('two refreshes with the same token at once: exactly one wins, the other 403 (not 500)', async () => {
  const { refreshToken } = await login();
  const results = await Promise.allSettled([auth.refresh(refreshToken), auth.refresh(refreshToken)]);
  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 403 });
});

it('another login of the same user is not touched by a revoked family', async () => {
  const other = await login();
  const { refreshToken: r1 } = await login();
  await auth.refresh(r1);
  await expect(auth.refresh(r1)).rejects.toMatchObject({ status: 403 });
  await expect(auth.refresh(other.refreshToken)).resolves.toHaveProperty('refreshToken');
});

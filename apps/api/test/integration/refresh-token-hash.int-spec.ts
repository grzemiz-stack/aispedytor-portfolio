/**
 * The migration `20261010140000_refresh_token_hash` on a real PostgreSQL:
 * existing plain-text tokens are hashed in the database with the same
 * function the API looks a token up with — nobody is logged out.
 *
 * The database from tools/demo-test.sh already has every migration, so the
 * old table shape is built next to it, in a separate schema (`legacy_rt`): a
 * row with a plain token, then this migration's SQL straight from the file.
 * The hash from the database must equal `hashRefreshToken` from the API, and
 * the same row moved into the real table must refresh with the same (old)
 * token.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService, hashRefreshToken } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const prisma = new PrismaClient();
const env: any = { get: (k: string) => process.env[k] };
const auth = new AuthService(prisma as any, new JwtService({}), env, new EncryptionService(env));
const MIGRATION = resolve(__dirname, '../../prisma/migrations/20261010140000_refresh_token_hash/migration.sql');
const statements = readFileSync(MIGRATION, 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(';').map((s) => s.trim()).filter(Boolean);

afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS legacy_rt CASCADE');
  await prisma.$disconnect();
});

it('an existing plain-text token: hashed by the migration exactly as the API looks it up, the session keeps working', async () => {
  const { user } = await auth.login({ email: 'admin@spedytor.example.com', password: 'Admin1234!' } as any);
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 86_400_000);

  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS legacy_rt CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA legacy_rt');
  // The table shape before this migration (after the token family).
  await prisma.$executeRawUnsafe(`CREATE TABLE legacy_rt.refresh_tokens (
    "id" TEXT PRIMARY KEY, "token" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "family_id" TEXT NOT NULL, "used_at" TIMESTAMP(3))`);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX "refresh_tokens_token_key" ON legacy_rt.refresh_tokens("token")');
  await prisma.$executeRawUnsafe(
    'INSERT INTO legacy_rt.refresh_tokens ("id", "token", "user_id", "expires_at", "family_id") VALUES ($1, $2, $3, $4, $5)',
    'legacy-1', raw, user.id, expiresAt, 'legacy-family',
  );

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL search_path TO legacy_rt');
    for (const sql of statements) await tx.$executeRawUnsafe(sql);
  });

  const [migrated] = await prisma.$queryRawUnsafe<{ token_hash: string }[]>('SELECT "token_hash" FROM legacy_rt.refresh_tokens');
  const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'legacy_rt' AND table_name = 'refresh_tokens' ORDER BY column_name",
  );
  expect(migrated.token_hash).toBe(hashRefreshToken(raw));
  expect(columns.map((c) => c.column_name)).not.toContain('token');

  await prisma.refreshToken.create({ data: { id: 'legacy-1', tokenHash: migrated.token_hash, userId: user.id, expiresAt, familyId: 'legacy-family' } });
  await expect(auth.refresh(raw)).resolves.toHaveProperty('refreshToken');
});

it('the table keeps no plain token: after a login only the hash is stored', async () => {
  const { refreshToken } = await auth.login({ email: 'admin@spedytor.example.com', password: 'Admin1234!' } as any);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    'SELECT * FROM refresh_tokens WHERE "token_hash" = $1', hashRefreshToken(refreshToken),
  );
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows[0])).not.toContain(refreshToken);
});

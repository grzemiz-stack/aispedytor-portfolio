/**
 * Trans.eu tokens encrypted in the database + migration of existing rows.
 *
 * The access and refresh tokens in `exchange_connections` are stored
 * encrypted; plain-text rows left from before are encrypted on module init.
 * The fake database keeps rows in memory; the encryption is real
 * (EncryptionService with a test key).
 */
import { EncryptionService } from '../../src/common/encryption/encryption.service';
import { TransEuAuthService, isEncryptedToken } from '../../src/trans-eu-auth/trans-eu-auth.service';

const KEY = 'cd'.repeat(32);

function setup(rows: any[] = []) {
  const db = rows;
  const prisma: any = {
    exchangeConnection: {
      findMany: jest.fn(async () => db.map(r => ({ id: r.id, accessToken: r.accessToken, refreshToken: r.refreshToken }))),
      findUnique: jest.fn(async ({ where }: any) => db.find(r => r.companyId === where.companyId_exchange.companyId) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(db.find(r => r.id === where.id || r.companyId === where.companyId_exchange?.companyId)!, data)),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const row = db.find(r => r.companyId === where.companyId_exchange.companyId);
        if (row) return Object.assign(row, update);
        db.push({ id: `c${db.length}`, ...create });
      }),
    },
  };
  const enc = new EncryptionService({ get: () => KEY } as any);
  return { svc: new TransEuAuthService(prisma, enc), db, enc };
}

const future = () => new Date(Date.now() + 3600_000);

describe('Trans.eu tokens are encrypted at rest', () => {
  it('saving stores both tokens encrypted, never the plain value', async () => {
    const { svc, db, enc } = setup();
    await (svc as any).saveTokens('comp-1', { access_token: 'AT-plain', refresh_token: 'RT-plain', expires_in: 3600 });
    const row = db[0];
    expect(isEncryptedToken(row.accessToken)).toBe(true);
    expect(isEncryptedToken(row.refreshToken)).toBe(true);
    expect(JSON.stringify(row)).not.toContain('AT-plain');
    expect(JSON.stringify(row)).not.toContain('RT-plain');
    expect(enc.decrypt(row.accessToken)).toBe('AT-plain');
  });

  it('reading returns the plain access token', async () => {
    const { svc } = setup();
    await (svc as any).saveTokens('comp-1', { access_token: 'AT-plain', refresh_token: 'RT-plain', expires_in: 3600 });
    await expect(svc.getValidAccessToken('comp-1')).resolves.toBe('AT-plain');
  });

  it('refresh sends the decrypted refresh token and stores the new pair encrypted', async () => {
    const { svc, db, enc } = setup([{ id: 'c0', companyId: 'comp-1', accessToken: '', refreshToken: '', accessTokenExpiresAt: new Date(0) }]);
    db[0].refreshToken = enc.encrypt('RT-old');
    db[0].accessToken = enc.encrypt('AT-old');
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 3600 }),
    } as any);
    process.env.TRANS_EU_CLIENT_ID = 'id'; process.env.TRANS_EU_CLIENT_SECRET = 'secret';
    await expect(svc.getValidAccessToken('comp-1')).resolves.toBe('AT-new');
    expect(String((fetchSpy.mock.calls[0][1] as any).body)).toContain('refresh_token=RT-old');
    expect(enc.decrypt(db[0].refreshToken)).toBe('RT-new');
    fetchSpy.mockRestore();
  });
});

describe('migration of existing plain-text tokens', () => {
  const legacy = () => [
    { id: 'c0', companyId: 'comp-1', accessToken: 'AT-legacy', refreshToken: 'RT-legacy', accessTokenExpiresAt: future() },
  ];

  it('encrypts plain rows on module init, keeping the values', async () => {
    const { svc, db, enc } = setup(legacy());
    await svc.onModuleInit();
    expect(isEncryptedToken(db[0].accessToken)).toBe(true);
    expect(enc.decrypt(db[0].refreshToken)).toBe('RT-legacy');
    await expect(svc.getValidAccessToken('comp-1')).resolves.toBe('AT-legacy');
  });

  it('is idempotent: a second run changes nothing (no double encryption)', async () => {
    const { svc, db } = setup(legacy());
    expect(await svc.encryptLegacyTokens()).toBe(1);
    const once = { ...db[0] };
    expect(await svc.encryptLegacyTokens()).toBe(0);
    expect(db[0]).toEqual(once);
  });

  it('a half-migrated row (one token already encrypted) ends with both encrypted, none twice', async () => {
    const { svc, db, enc } = setup(legacy());
    db[0].accessToken = enc.encrypt('AT-legacy');
    await svc.encryptLegacyTokens();
    expect(enc.decrypt(db[0].accessToken)).toBe('AT-legacy');
    expect(enc.decrypt(db[0].refreshToken)).toBe('RT-legacy');
  });

  it('before migration a plain row is still readable (no outage between deploy and init)', async () => {
    const { svc } = setup(legacy());
    await expect(svc.getValidAccessToken('comp-1')).resolves.toBe('AT-legacy');
  });
});

/**
 * Company registration: a taken e-mail and a bad tax ID used to throw a plain
 * `Error` (500); the tax ID (10 digits only) was checked for every country;
 * company and user were written separately, so a failure on the user left a
 * company without an account.
 *
 * The Prisma stub has transaction semantics: writes inside `$transaction`
 * reach the "database" only when the whole block succeeds.
 */
import { Prisma } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service';
import type { RegisterCompanyDto } from '../../src/auth/dto/register-company.dto';

type Row = Record<string, any>;

function stub(opts: { userCreateFails?: 'P2002' | 'OTHER' } = {}) {
  const db = { companies: [] as Row[], users: [{ id: 'u-old', emailHash: 'hash:zajety@firma.example.com' }] as Row[], tokens: [] as Row[] };
  let n = 0;
  const writer = (target: typeof db) => ({
    company: { create: jest.fn(async ({ data }: any) => { const c = { id: `c-${++n}`, ...data }; target.companies.push(c); return c; }) },
    user: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.userCreateFails === 'P2002') throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        if (opts.userCreateFails === 'OTHER') throw new Error('database down');
        const u = { id: `u-${++n}`, ...data }; target.users.push(u); return u;
      }),
    },
  });
  const prisma: any = {
    ...writer(db),
    user: {
      ...writer(db).user,
      findUnique: jest.fn(async ({ where }: any) => db.users.find((u) => u.emailHash === where.emailHash) ?? null),
    },
    refreshToken: { create: jest.fn(async ({ data }: any) => { db.tokens.push(data); return data; }) },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const staged = { companies: [] as Row[], users: [] as Row[], tokens: [] as Row[] };
      const result = await fn(writer(staged));
      db.companies.push(...staged.companies);
      db.users.push(...staged.users);
      return result;
    }),
  };
  const enc = { encrypt: (t: string) => `enc:${t}`, hash: (t: string) => `hash:${t}` };
  const jwt = { sign: jest.fn(() => 'jwt') };
  const config = { get: jest.fn(() => 'secret-for-tests-0123456789abcdef0123456789abcdef') };
  const service = new AuthService(prisma, jwt as any, config as any, enc as any);
  return { db, prisma, service };
}

const DTO: RegisterCompanyDto = {
  companyName: 'Test Company',
  taxId: '123-456-32-18',
  email: 'nowy@firma.example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
  password: 'Haslo-Testowe-1!',
};

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e: any) {
    return [e.getStatus?.() ?? 'raw', e.getResponse?.().code ?? e.message];
  }
}

describe('a valid registration', () => {
  it('company and administrator in one transaction; the tax ID stored as digits; tokens after the write', async () => {
    const { db, prisma, service } = stub();
    const r = await service.registerCompany(DTO);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.company.create).not.toHaveBeenCalled(); // only through the transaction
    expect([db.companies.map((c) => [c.taxId, c.country]), db.users.slice(1).map((u) => [u.role, u.companyId])])
      .toEqual([[['1234563218', 'PL']], [['ADMIN', r.companyId]]]);
    expect(r.accessToken).toBe('jwt');
  });

  it('country "pl" in lower case: validated as PL and stored as "PL"', async () => {
    const { db, service } = stub();
    expect(await errorOf(service.registerCompany({ ...DTO, country: 'pl', taxId: '123' }))).toEqual([400, 'REGISTER_TAX_ID_INVALID']);
    await service.registerCompany({ ...DTO, country: ' pl ' });
    expect(db.companies[0].country).toBe('PL');
  });

  it('a company outside PL: the number stored as given (no Polish validation)', async () => {
    const { db, service } = stub();
    await service.registerCompany({ ...DTO, country: 'DE', taxId: ' DE123456789 ' });
    expect([db.companies[0].taxId, db.companies[0].country, db.companies[0].costCurrency]).toEqual(['DE123456789', 'DE', 'EUR']);
  });
});

describe('coded errors instead of 500', () => {
  it('a taken e-mail → 409 REGISTER_EMAIL_TAKEN, nothing written', async () => {
    const { db, prisma, service } = stub();
    expect(await errorOf(service.registerCompany({ ...DTO, email: 'zajety@firma.example.com' }))).toEqual([409, 'REGISTER_EMAIL_TAKEN']);
    expect([db.companies.length, prisma.$transaction.mock.calls.length]).toEqual([0, 0]);
  });

  it.each([['123'], ['1234563219'], ['1234567890'], ['DE123456789']])('tax ID %s in PL → 400 REGISTER_TAX_ID_INVALID, nothing written', async (taxId) => {
    const { db, service } = stub();
    expect(await errorOf(service.registerCompany({ ...DTO, taxId }))).toEqual([400, 'REGISTER_TAX_ID_INVALID']);
    expect(db.companies.length).toBe(0);
  });

  it('two registrations at once: the unique index (P2002) → 409, and the company rolled back', async () => {
    const { db, service } = stub({ userCreateFails: 'P2002' });
    expect(await errorOf(service.registerCompany(DTO))).toEqual([409, 'REGISTER_EMAIL_TAKEN']);
    expect(db.companies).toEqual([]);
  });

  it('another error on the user: passed on (500), company rolled back, no tokens', async () => {
    const { db, service } = stub({ userCreateFails: 'OTHER' });
    expect(await errorOf(service.registerCompany(DTO))).toEqual(['raw', 'database down']);
    expect([db.companies, db.tokens]).toEqual([[], []]);
  });
});

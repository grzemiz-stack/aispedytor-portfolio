/**
 * Company currency from its country — at registration (AuthService) and in the
 * migration backfill for existing companies. GB → GBP, euro area → EUR, rest → PLN.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { currencyForCountry } from '../../src/common/company-currency';
import { AuthService } from '../../src/auth/auth.service';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

describe('currencyForCountry', () => {
  it.each([
    ['PL', 'PLN'],
    ['GB', 'GBP'],
    ['DE', 'EUR'],
    ['BG', 'EUR'], // in the euro area since 2026-01-01
    ['HR', 'EUR'],
    ['CH', 'PLN'], // the franc is not in the currency list — docs/decisions.md §3
    ['CZ', 'PLN'],
    ['ME', 'PLN'], // uses the euro but is not a member of the euro area
    ['UK', 'PLN'], // not an ISO code; the United Kingdom is GB
  ])('%s → %s', (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency);
  });

  it('free text from registration: trimmed and upper-cased', () => {
    expect(currencyForCountry(' gb ')).toBe('GBP');
    expect(currencyForCountry('de')).toBe('EUR');
  });

  it.each([[null], [undefined], ['']])('no country (%p) → PLN', country => {
    expect(currencyForCountry(country)).toBe('PLN');
  });
});

describe('AuthService.registerCompany — new company gets the currency of its country', () => {
  async function register(country?: string) {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      company: { create: jest.fn().mockResolvedValue({ id: 'comp-1', name: 'Firma' }) },
    };
    // Registration writes the company and the account in one transaction.
    prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
    // EncryptionService with a real (test) key — registration encrypts through it.
    const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
    const service = new AuthService(prisma, {} as any, {} as any, enc);
    (service as any).generateTokens = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    await service.registerCompany({
      companyName: 'Firma', taxId: '5260250274', email: 'a@example.net',
      firstName: 'Jan', lastName: 'Kowalski', password: 'Haslo1234!', country,
    });
    return prisma.company.create.mock.calls[0][0].data;
  }

  it('GB → GBP', async () => {
    expect(await register('GB')).toMatchObject({ country: 'GB', costCurrency: 'GBP' });
  });

  it('DE → EUR', async () => {
    expect(await register('DE')).toMatchObject({ country: 'DE', costCurrency: 'EUR' });
  });

  it('no country → PL and PLN', async () => {
    expect(await register(undefined)).toMatchObject({ country: 'PL', costCurrency: 'PLN' });
  });
});

describe('registration sets up no plan, trial or usage limit (out of scope)', () => {
  it('the company row has no trial or AI-call fields', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      company: { create: jest.fn().mockResolvedValue({ id: 'comp-1', name: 'Firma' }) },
    };
    prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
    const service = new AuthService(prisma, {} as any, {} as any, new EncryptionService({ get: () => 'ab'.repeat(32) } as any));
    (service as any).generateTokens = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    await service.registerCompany({
      companyName: 'Firma', taxId: '5260250274', email: 'a@example.net',
      firstName: 'Jan', lastName: 'Kowalski', password: 'Haslo1234!', country: 'PL',
    });
    const data = prisma.company.create.mock.calls[0][0].data;
    for (const field of ['trialEndsAt', 'aiCallsToday', 'aiCallsDate', 'aiCallsLimit']) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it('the schema has none of those columns and a migration drops them', () => {
    const prismaDir = resolve(__dirname, '../../prisma');
    const schema = readFileSync(resolve(prismaDir, 'schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/trialEndsAt|aiCalls(Today|Date|Limit)/);
    const sql = readdirSync(resolve(prismaDir, 'migrations'))
      .filter((d: string) => d.endsWith('_drop_trial_and_ai_limit'))
      .map((d: string) => readFileSync(resolve(prismaDir, 'migrations', d, 'migration.sql'), 'utf8')).join('\n');
    for (const col of ['trial_ends_at', 'ai_calls_today', 'ai_calls_date', 'ai_calls_limit']) {
      expect(sql).toContain(`DROP COLUMN "${col}"`);
    }
  });
});

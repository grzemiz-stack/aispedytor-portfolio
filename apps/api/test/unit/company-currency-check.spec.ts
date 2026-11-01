/**
 * The currency list in the database CHECK == the COMPANY_CURRENCIES constant in TypeScript.
 *
 * The migration is read straight from the file. A currency added only in the
 * code (or only in the database) fails this test before it reaches
 * production as a write error.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPANY_CURRENCIES, EUROZONE_COUNTRIES } from '../../src/common/company-currency';

const MIGRATIONS = resolve(__dirname, '../../prisma/migrations');

/** The last migration that defines the currency CHECK — that one is in force. */
function currenciesFromLatestCheck(): string[] {
  const dirs = readdirSync(MIGRATIONS).filter(d => /^\d+_/.test(d)).sort();
  let found: string[] | null = null;
  for (const dir of dirs) {
    const sql = readFileSync(resolve(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    const m = sql.match(/companies_cost_currency_check"\s*CHECK\s*\(\s*"cost_currency"\s+IN\s*\(([^)]*)\)/);
    if (m) found = (m[1].match(/'([^']+)'/g) ?? []).map(s => s.slice(1, -1));
  }
  if (!found) throw new Error('No CHECK on companies.cost_currency found in migrations');
  return found;
}

describe('company currency CHECK vs COMPANY_CURRENCIES', () => {
  it('the database list and the code list are the same set', () => {
    expect([...currenciesFromLatestCheck()].sort()).toEqual([...COMPANY_CURRENCIES].sort());
  });
});

describe('backfill in the migration vs currencyForCountry', () => {
  const sql = readFileSync(
    resolve(MIGRATIONS, '20261001090000_company_cost_per_km', 'migration.sql'),
    'utf8',
  );
  const quoted = (s: string) => (s.match(/'([^']+)'/g) ?? []).map(q => q.slice(1, -1));

  it('GB → GBP', () => {
    expect(sql).toMatch(/WHEN UPPER\(TRIM\("country"\)\) = 'GB' THEN 'GBP'/);
  });

  it('the euro-area list is the same set as EUROZONE_COUNTRIES', () => {
    const m = sql.match(/WHEN UPPER\(TRIM\("country"\)\) IN \(([^)]*)\) THEN 'EUR'/);
    expect(m).not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...EUROZONE_COUNTRIES].sort());
  });

  it('everything else → PLN', () => {
    expect(sql).toMatch(/ELSE 'PLN'\s*END/);
  });
});

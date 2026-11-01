/**
 * The category list in the database CHECK == the VEHICLE_CATEGORIES constant in TypeScript.
 *
 * The migration is read straight from the file. A new category added only in
 * the code (or only in the database) fails this test before it reaches
 * production as a write error.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLE_CATEGORIES } from '../../src/common/vehicle-category';

const MIGRATIONS = resolve(__dirname, '../../prisma/migrations');

/** The last migration that defines the category CHECK — that one is in force. */
function categoriesFromLatestCheck(): string[] {
  const dirs = readdirSync(MIGRATIONS).filter(d => /^\d+_/.test(d)).sort();
  let found: string[] | null = null;
  for (const dir of dirs) {
    const sql = readFileSync(resolve(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    const m = sql.match(/vehicles_vehicle_category_check"\s*CHECK\s*\(\s*"vehicle_category"\s+IN\s*\(([^)]*)\)/);
    if (m) found = (m[1].match(/'([^']+)'/g) ?? []).map(s => s.slice(1, -1));
  }
  if (!found) throw new Error('No CHECK on vehicles.vehicle_category found in migrations');
  return found;
}

describe('vehicle category CHECK vs VEHICLE_CATEGORIES', () => {
  it('the database list and the code list are the same set', () => {
    expect([...categoriesFromLatestCheck()].sort()).toEqual([...VEHICLE_CATEGORIES].sort());
  });
});

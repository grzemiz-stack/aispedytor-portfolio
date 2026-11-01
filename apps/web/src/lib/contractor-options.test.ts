/**
 * Contractors in the offer form: every page, active only, the blacklist
 * marked.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { contractorOptionLabel, loadContractorOptions } from './contractor-options';
import { offerPayload } from './offer-form';

const row = (i: number, extra: object = {}) => ({ id: `k${i}`, name: `K${i}`, isActive: true, isBlacklisted: false, ...extra });

it('reads every page (not only the first 100)', async () => {
  const pages = [
    { data: Array.from({ length: 100 }, (_, i) => row(i)), totalPages: 3 },
    { data: Array.from({ length: 100 }, (_, i) => row(100 + i)), totalPages: 3 },
    { data: [row(200)], totalPages: 3 },
  ];
  const asked: number[] = [];
  const out = await loadContractorOptions(async (page, limit) => { asked.push(page); expect(limit).toBe(100); return pages[page - 1]; });
  expect(asked).toEqual([1, 2, 3]);
  expect(out).toHaveLength(201);
});

it('only active contractors; a blacklisted one stays, marked', async () => {
  const out = await loadContractorOptions(async () => ({
    data: [row(1), row(2, { isActive: false }), row(3, { isBlacklisted: true })], totalPages: 1,
  }));
  expect(out.map((c) => c.id)).toEqual(['k1', 'k3']);
  expect(out.map(contractorOptionLabel)).toEqual(['K1', 'K3 — czarna lista']);
});

describe('the new offer form sends the chosen contractor', () => {
  const BOOLS = { palletExchange: false, isAdr: false, isFrigo: false };

  it('chosen → contractorId in the body; none → no field (the API keeps the offer without one)', () => {
    expect(offerPayload({ contractorId: 'k1' }, BOOLS).contractorId).toBe('k1');
    expect(offerPayload({ contractorId: '' }, BOOLS).contractorId).toBeUndefined();
  });

  it('the form loads the contractors and binds the select to contractorId', () => {
    const page = readFileSync(resolve(__dirname, '../app/(dashboard)/offers/new/page.tsx'), 'utf8');
    expect(page).toMatch(/loadContractorOptions\(/);
    expect(page).toMatch(/value=\{form\.contractorId\}/);
    expect(page).toMatch(/set\('contractorId', e\.target\.value\)/);
  });
});

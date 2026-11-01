/**
 * Sorting the offer list by margin works. The web table
 * sends `sortBy=profitMarginPercent`; the allow-list did not have it, so the
 * list was silently sorted by date while the arrow showed "margin".
 * Nullable columns sort with the empty values last, either direction.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFER_SORT_COLUMNS, OffersService } from '../../src/offers/offers.service';

function orderByFor(sortBy: string, sortOrder: 'asc' | 'desc' = 'desc') {
  const findMany = jest.fn(async () => []);
  const prisma: any = { offer: { findMany, count: async () => 0 } };
  const cache: any = { get: () => undefined, set: () => undefined };
  return new OffersService(prisma, {} as any, cache, {} as any)
    .findAll('comp-1', { page: 1, limit: 20, sortBy, sortOrder } as any)
    .then(() => (findMany.mock.calls[0] as any[])[0].orderBy);
}

it.each([
  // The margin: full ones, then upper bounds (no toll), empty last.
  ['profitMarginPercent', 'desc', [{ marginWithoutTolls: { sort: 'asc', nulls: 'last' } }, { profitMarginPercent: { sort: 'desc', nulls: 'last' } }]],
  ['profitMarginPercent', 'asc', [{ marginWithoutTolls: { sort: 'asc', nulls: 'last' } }, { profitMarginPercent: { sort: 'asc', nulls: 'last' } }]],
  ['price', 'desc', { price: { sort: 'desc', nulls: 'last' } }],
  ['pricePerKm', 'asc', { pricePerKm: { sort: 'asc', nulls: 'last' } }],
  ['distanceKm', 'desc', { distanceKm: { sort: 'desc', nulls: 'last' } }],
  ['pickupDate', 'asc', { pickupDate: 'asc' }],
  ['createdAt', 'desc', { createdAt: 'desc' }],
])('sortBy=%s %s → %j', async (sortBy, order, expected) => {
  expect(await orderByFor(sortBy, order as 'asc' | 'desc')).toEqual(expected);
});

it('a column outside the allow-list still falls back to createdAt', async () => {
  expect(await orderByFor('companyId')).toEqual({ createdAt: 'desc' });
});

it('the web table sorts only by allowed columns', () => {
  const page = readFileSync(resolve(__dirname, '../../../web/src/app/(dashboard)/offers/page.tsx'), 'utf8');
  const keys = [...page.matchAll(/sortKey: '(\w+)'/g)].map((m: RegExpMatchArray) => m[1]);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((k: string) => !(OFFER_SORT_COLUMNS as readonly string[]).includes(k))).toEqual([]);
});

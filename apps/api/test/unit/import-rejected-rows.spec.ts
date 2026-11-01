/**
 * Offer import: valid rows saved, bad ones returned as {row, field, code}.
 *
 * Before: every row was checked by the ValidationPipe — one bad row gave 400
 * for the whole batch; and when it passed validation, an unreadable date
 * (`Invalid Date`) or an amount over DECIMAL(10,2) broke `createMany` — a 500
 * and nothing of the batch in the database. Now: the request structure still
 * gives 400; every row is checked on its own, a row with a problem goes to
 * `rejected` (the index in `offers` from 0, the field, the code), the rest is
 * saved.
 */
import { OffersService } from '../../src/offers/offers.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const ROW = { externalId: 'X', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: '10.10.2026', weightKg: '24000', price: 1200 };

function makeService() {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    offer: {
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      findMany: jest.fn(async () => []),
    },
  };
  const service = new OffersService(prisma, { checkNewOfferAgainstDemands: jest.fn(async () => []) } as any, { deleteByPrefix: jest.fn() } as any, { enqueue: jest.fn() } as any);
  return { service, prisma };
}
const saved = (prisma: any) => (prisma.offer.createMany.mock.calls[0]?.[0].data ?? []).map((d: any) => d.externalId);

it('a mixed batch: the valid rows are saved, each bad row comes back with its field and code', async () => {
  const { service, prisma } = makeService();
  const r = await service.importOffers('comp-1', {
    source: 'api',
    offers: [
      { ...ROW, externalId: 'ok-1' },
      { ...ROW, externalId: 'no-city', pickupCity: undefined },
      { ...ROW, externalId: 'bad-date', pickupDate: '32.13.2026' },
      { ...ROW, externalId: 'huge-price', price: 100_000_000 },
      { ...ROW, externalId: 'ok-2' },
    ],
  } as any);
  expect(r).toEqual({
    imported: 2,
    duplicates: 0,
    rejected: [
      { row: 1, field: 'pickupCity', code: 'IMPORT_ROW_FIELD_INVALID' },
      { row: 2, field: 'pickupDate', code: 'IMPORT_ROW_DATE_INVALID' },
      { row: 3, field: 'price', code: 'OFFER_VALUE_OUT_OF_RANGE' },
    ],
  });
  expect(saved(prisma)).toEqual(['ok-1', 'ok-2']);
});

it.each([
  ['weightKg', 'dużo', 'IMPORT_ROW_FIELD_INVALID'],
  ['price', 'tysiąc', 'IMPORT_ROW_FIELD_INVALID'],
  ['deliveryDate', 'jutro', 'IMPORT_ROW_DATE_INVALID'],
  ['pickupDate', '', 'IMPORT_ROW_FIELD_INVALID'],
  ['pricePerKm', 100_000_000, 'OFFER_VALUE_OUT_OF_RANGE'],
  ['price', -1, 'OFFER_VALUE_OUT_OF_RANGE'],
  ['color', 'red', 'IMPORT_ROW_FIELD_INVALID'],
])('%s = %p → rejected with %s, nothing saved', async (field, value, code) => {
  const { service, prisma } = makeService();
  const r = await service.importOffers('comp-1', { source: 'api', offers: [{ ...ROW, [field]: value }] } as any);
  expect([r.imported, r.rejected]).toEqual([0, [{ row: 0, field, code }]]);
  expect(prisma.offer.createMany).not.toHaveBeenCalled();
});

it('the computed rate (price / distance) over DECIMAL(10,2) is rejected as pricePerKm', async () => {
  const { service } = makeService();
  const r = await service.importOffers('comp-1', { source: 'api', offers: [{ ...ROW, price: 1_000_000, distanceKm: 0.001 }] } as any);
  expect(r.rejected).toEqual([{ row: 0, field: 'pricePerKm', code: 'OFFER_VALUE_OUT_OF_RANGE' }]);
});

it('exactly the DECIMAL(10,2) maximum still fits', async () => {
  const { service, prisma } = makeService();
  const r = await service.importOffers('comp-1', { source: 'api', offers: [{ ...ROW, price: 99_999_999.99 }] } as any);
  expect([r.imported, r.rejected, prisma.offer.createMany.mock.calls[0][0].data[0].price]).toEqual([1, [], 99_999_999.99]);
});

it('a row that is not an object → rejected as a whole row (field null)', async () => {
  const { service } = makeService();
  const r = await service.importOffers('comp-1', { source: 'api', offers: [null, { ...ROW }] } as any);
  expect([r.imported, r.rejected]).toEqual([1, [{ row: 0, field: null, code: 'IMPORT_ROW_FIELD_INVALID' }]]);
});

it('numbers given as strings are still converted (as before)', async () => {
  const { service, prisma } = makeService();
  await service.importOffers('comp-1', { source: 'api', offers: [{ ...ROW }] } as any);
  expect(prisma.offer.createMany.mock.calls[0][0].data[0].weightKg).toBe(24000);
});

it('an empty list: zeros, nothing rejected, nothing saved', async () => {
  const { service, prisma } = makeService();
  expect(await service.importOffers('comp-1', { source: 'api', offers: [] } as any)).toEqual({ imported: 0, duplicates: 0, rejected: [] });
  expect(prisma.offer.createMany).not.toHaveBeenCalled();
});

it('the three codes are in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toEqual(expect.arrayContaining(['IMPORT_ROW_FIELD_INVALID', 'IMPORT_ROW_DATE_INVALID', 'OFFER_VALUE_OUT_OF_RANGE']));
});

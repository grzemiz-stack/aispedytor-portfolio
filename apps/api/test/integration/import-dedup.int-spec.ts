/**
 * Offer import on a real PostgreSQL.
 *
 * Deduplication is done by the database: the unique index (company_id,
 * source, external_id) and `createMany({ skipDuplicates: true })` — a fake
 * cannot show it. Here: a re-import of the same `externalId`s doubles
 * nothing; another source is another offer; a bad row (a date, an amount over
 * DECIMAL(10,2)) comes back in `rejected`, and the rest of the batch is in the
 * database — no 500.
 *
 * Known and pinned: a row WITHOUT `externalId` is not deduplicated (in
 * PostgreSQL NULL ≠ NULL in a unique index) — a re-import doubles it.
 */
import { PrismaClient } from '@prisma/client';
import { OffersService } from '../../src/offers/offers.service';

const prisma = new PrismaClient();
const service = new OffersService(
  prisma as any,
  { checkNewOfferAgainstDemands: async () => [] } as any,
  { deleteByPrefix: () => undefined } as any,
  { enqueue: async () => undefined } as any,
);
const MARK = 'IMPTEST';
const row = (externalId: string | undefined, over: Record<string, unknown> = {}) => ({
  ...(externalId ? { externalId: `${MARK}-${externalId}` } : {}),
  pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
  pickupDate: '10.10.2030', price: 1200, currency: 'EUR', clientName: MARK, ...over,
});
let companyId: string;

beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ select: { id: true } })).id;
});
afterAll(async () => {
  await prisma.offer.deleteMany({ where: { companyId, clientName: MARK } });
  await prisma.$disconnect();
});
const count = (where: object = {}) => prisma.offer.count({ where: { companyId, clientName: MARK, ...where } });

it('re-import of the same externalIds: nothing doubled, only the new one saved', async () => {
  expect(await service.importOffers(companyId, { source: 'api', offers: [row('1'), row('2')] })).toEqual({ imported: 2, duplicates: 0, rejected: [] });
  expect(await service.importOffers(companyId, { source: 'api', offers: [row('1'), row('2'), row('3')] })).toEqual({ imported: 1, duplicates: 2, rejected: [] });
  expect(await count({ externalId: { in: [`${MARK}-1`, `${MARK}-2`, `${MARK}-3`] } })).toBe(3);
});

it('the same externalId from another source is another offer', async () => {
  expect(await service.importOffers(companyId, { source: 'email', offers: [row('1')] })).toMatchObject({ imported: 1, duplicates: 0 });
  expect(await count({ externalId: `${MARK}-1` })).toBe(2);
});

it('bad rows come back in rejected, the rest of the batch is in the database (no 500)', async () => {
  const r = await service.importOffers(companyId, {
    source: 'api',
    offers: [row('bad-date', { pickupDate: '32.13.2030' }), row('huge', { price: 100_000_000 }), row('ok')],
  });
  expect(r).toEqual({
    imported: 1,
    duplicates: 0,
    rejected: [
      { row: 0, field: 'pickupDate', code: 'IMPORT_ROW_DATE_INVALID' },
      { row: 1, field: 'price', code: 'OFFER_VALUE_OUT_OF_RANGE' },
    ],
  });
  expect(await count({ externalId: { in: [`${MARK}-bad-date`, `${MARK}-huge`, `${MARK}-ok`] } })).toBe(1);
});

it('known: a row WITHOUT externalId is not deduplicated — a re-import doubles it', async () => {
  const noId = row(undefined, { deliveryCity: 'Hamburg' });
  await service.importOffers(companyId, { source: 'api', offers: [noId] });
  expect(await service.importOffers(companyId, { source: 'api', offers: [noId] })).toMatchObject({ imported: 1, duplicates: 0 });
  expect(await count({ externalId: null, deliveryCity: 'Hamburg' })).toBe(2);
});

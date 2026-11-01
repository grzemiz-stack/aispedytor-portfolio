/**
 * OffersService.importOffers — the offer import path.
 *
 * Two rules under test:
 *  1) demand matching gets the rows as saved, with the `id` the database
 *     assigned — a notification never has `offerId: undefined`;
 *  2) matching runs only for offers actually inserted, not for those
 *     `createMany({ skipDuplicates: true })` skipped — no notifications for
 *     offers that are not in the database.
 *
 * No I/O: Prisma, the queue and the cache are fakes.
 */
import { OffersService } from '../../src/offers/offers.service';

type RawInput = Record<string, any>;

const rawOffer = (externalId: string, over: RawInput = {}): any => ({
  externalId,
  pickupCity: 'Warszawa',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  pickupDate: '2026-09-10',
  price: 1200,
  currency: 'EUR',
  weightKg: 12000,
  ...over,
});

/** A row as the database returns it — with the `id` the database assigned. */
const dbRow = (id: string, externalId: string, over: RawInput = {}) => ({
  id,
  externalId,
  companyId: 'comp-1',
  source: 'TRANS_EU',
  status: 'NEW',
  pickupCity: 'Warszawa',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  weightKg: 12000,
  isAdr: false,
  isFrigo: false,
  ...over,
});

function makeService(opts: {
  createdCount: number;
  inserted?: any[];
}) {
  const enqueued: Array<() => any> = [];

  const prisma: any = {

    // The company cost per km and the planner route — the margin on save; none → no margin.

    company: { findUnique: async () => null },

    routeCalculation: { findFirst: async () => null },
    offer: {
      createMany: jest.fn().mockResolvedValue({ count: opts.createdCount }),
      findMany: jest.fn().mockResolvedValue(opts.inserted ?? []),
    },
  };

  const demandsService: any = { checkNewOfferAgainstDemands: jest.fn().mockResolvedValue([]) };
  const cache: any = { deleteByPrefix: jest.fn() };
  const taskQueue: any = {
    enqueue: (fn: () => any) => {
      enqueued.push(fn);
      return Promise.resolve(fn());
    },
  };

  const service = new OffersService(prisma, demandsService, cache, taskQueue);
  return { service, prisma, demandsService, cache, enqueued };
}

/** Offers passed to matching, in call order. */
const matchedOffers = (demandsService: any) =>
  demandsService.checkNewOfferAgainstDemands.mock.calls.map((c: any[]) => c[1]);

describe('importOffers — the offer passed to matching comes from the database', () => {
  it('every offer has the id the database assigned', async () => {
    const { service, demandsService } = makeService({
      createdCount: 1,
      inserted: [dbRow('db-1', 'TRN-001')],
    });

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer('TRN-001')] });

    const offers = matchedOffers(demandsService);
    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('db-1');
  });

  it('no passed object has an undefined id', async () => {
    const { service, demandsService } = makeService({
      createdCount: 2,
      inserted: [dbRow('db-1', 'TRN-001'), dbRow('db-2', 'TRN-002')],
    });

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('TRN-001'), rawOffer('TRN-002')],
    });

    matchedOffers(demandsService).forEach((o: any) => {
      expect(o.id).toBeDefined();
      expect(typeof o.id).toBe('string');
    });
  });

  it('passes the database row, not the input object — it carries the default status', async () => {
    const { service, demandsService } = makeService({
      createdCount: 1,
      inserted: [dbRow('db-1', 'TRN-001', { status: 'NEW' })],
    });

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer('TRN-001')] });

    expect(matchedOffers(demandsService)[0]).toMatchObject({ id: 'db-1', status: 'NEW' });
  });
});

describe('importOffers — matching only for offers actually inserted', () => {
  it('three offers, two skipped as duplicates -> one match', async () => {
    const { service, demandsService } = makeService({
      createdCount: 1,
      inserted: [dbRow('db-3', 'TRN-003')],
    });

    const res = await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('TRN-001'), rawOffer('TRN-002'), rawOffer('TRN-003')],
    });

    expect(res).toMatchObject({ imported: 1, duplicates: 2 });
    expect(demandsService.checkNewOfferAgainstDemands).toHaveBeenCalledTimes(1);
    expect(matchedOffers(demandsService)[0].externalId).toBe('TRN-003');
  });

  it('all offers are duplicates -> no match', async () => {
    const { service, demandsService } = makeService({ createdCount: 0, inserted: [] });

    const res = await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('TRN-001'), rawOffer('TRN-002')],
    });

    expect(res).toMatchObject({ imported: 0, duplicates: 2 });
    expect(demandsService.checkNewOfferAgainstDemands).not.toHaveBeenCalled();
  });

  it('the number of matches equals the number of inserted rows', async () => {
    const { service, demandsService } = makeService({
      createdCount: 2,
      inserted: [dbRow('db-1', 'TRN-001'), dbRow('db-4', 'TRN-004')],
    });

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('TRN-001'), rawOffer('TRN-002'), rawOffer('TRN-003'), rawOffer('TRN-004')],
    });

    expect(demandsService.checkNewOfferAgainstDemands).toHaveBeenCalledTimes(2);
    expect(matchedOffers(demandsService).map((o: any) => o.externalId)).toEqual(['TRN-001', 'TRN-004']);
  });
});

describe('importOffers — reading back the inserted rows', () => {
  it('reads the inserted offers by company, source and import stamp', async () => {
    const { service, prisma } = makeService({ createdCount: 1, inserted: [dbRow('db-1', 'TRN-001')] });

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer('TRN-001')] });

    expect(prisma.offer.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.offer.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe('comp-1');
    // 'transeu' has no mapping (there are no exchange adapters) — an unknown
    // source key is stored as GENERIC.
    expect(where.source).toBe('GENERIC');
    expect(where.importedAt).toBeInstanceOf(Date);
    // the same stamp that went into createMany
    expect(where.importedAt).toEqual(prisma.offer.createMany.mock.calls[0][0].data[0].importedAt);
  });

  it('does not query the database when nothing was inserted', async () => {
    const { service, prisma } = makeService({ createdCount: 0, inserted: [] });

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer('TRN-001')] });

    expect(prisma.offer.findMany).not.toHaveBeenCalled();
  });
});

describe('importOffers — result counts, rejected rows and cache', () => {
  it('returns the imported/duplicates/rejected counts', async () => {
    const { service } = makeService({ createdCount: 2, inserted: [dbRow('a', 'A'), dbRow('b', 'B')] });

    const res = await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('A'), rawOffer('B'), rawOffer('C')],
    });

    expect(res).toEqual({ imported: 2, duplicates: 1, rejected: [] });
  });

  it('an empty offer list: zeros, nothing rejected, nothing written', async () => {
    const { service, prisma, demandsService } = makeService({ createdCount: 0 });

    const res = await service.importOffers('comp-1', { source: 'transeu', offers: [] });

    expect(res).toEqual({ imported: 0, duplicates: 0, rejected: [] });
    expect(prisma.offer.createMany).not.toHaveBeenCalled();
    expect(demandsService.checkNewOfferAgainstDemands).not.toHaveBeenCalled();
  });

  it('a row that is not an offer goes to rejected and does not block the other offers', async () => {
    const { service } = makeService({ createdCount: 1, inserted: [dbRow('db-1', 'B')] });

    const res = await service.importOffers('comp-1', {
      source: 'manual',
      offers: [null as any, rawOffer('B')],
    });

    expect(res.rejected).toEqual([{ row: 0, field: null, code: 'IMPORT_ROW_FIELD_INVALID' }]);
    expect(res.imported).toBe(1);
  });

  it('invalidates the company’s offer cache', async () => {
    const { service, cache } = makeService({ createdCount: 1, inserted: [dbRow('db-1', 'A')] });

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer('A')] });

    expect(cache.deleteByPrefix).toHaveBeenCalledWith('offers:comp-1');
  });

  it('all rows in createMany have the same importedAt stamp', async () => {
    const { service, prisma } = makeService({ createdCount: 3, inserted: [] });

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer('A'), rawOffer('B'), rawOffer('C')],
    });

    const data = prisma.offer.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(3);
    const importStamps = new Set(data.map((d: any) => d.importedAt.getTime()));
    expect(importStamps.size).toBe(1);
  });
});

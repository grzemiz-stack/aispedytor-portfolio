/**
 * DemandsService — the wrapper around the shared predicate.
 * Checks that SQL narrows only the scope (company/status), that the domain
 * criteria go through matchOfferToDemand, and that the unknown criteria reach the API.
 */
import { DemandsService } from '../../src/demands/demands.service';

const demand = {
  id: 'dem-1',
  companyId: 'comp-1',
  dispatcherId: 'user-1',
  title: 'Zapotrzebowanie',
  status: 'OPEN',
  isActive: true,
  autoNotify: true,
  preferredCountries: ['PL'],
  maxWeight: 24,
  adrRequired: false,
  temperatureRequired: false,
};

const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pickupCity: 'Warszawa',
  deliveryCity: 'Berlin',
  weightKg: 12000,
  isAdr: false,
  isFrigo: false,
  ...over,
});

function makeService(offers: any[], demandOver: Record<string, any> = {}) {
  const prisma: any = {
    dispatcherDemand: {
      findFirst: jest.fn().mockResolvedValue({ ...demand, ...demandOver }),
      findMany: jest.fn().mockResolvedValue([{ ...demand, ...demandOver }]),
      update: jest.fn().mockResolvedValue({}),
    },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    notification: { create: jest.fn().mockResolvedValue({}) },
  };
  return { service: new DemandsService(prisma), prisma };
}

describe('searchOffers — SQL query', () => {
  it('filters only by company and offer status', async () => {
    const { service, prisma } = makeService([]);
    await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(prisma.offer.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'comp-1',
      status: { in: ['NEW', 'ASSIGNED'] },
    });
  });

  it('no domain criterion goes into SQL', async () => {
    const { service, prisma } = makeService([], {
      preferredCountries: ['PL', 'CZ'],
      maxWeight: 24,
      adrRequired: true,
      temperatureRequired: true,
    });
    await service.searchOffers('dem-1', 'comp-1', 'user-1');

    const where = prisma.offer.findMany.mock.calls[0][0].where;
    ['pickupCountry', 'weightKg', 'isAdr', 'isFrigo'].forEach((k) => {
      expect(where).not.toHaveProperty(k);
    });
  });
});

describe('searchOffers — criteria evaluated in memory', () => {
  it('returns only offers matched by the predicate', async () => {
    const { service } = makeService([
      offer('ok'),
      offer('zly-kraj', { pickupCountry: 'ES' }),
      offer('za-ciezka', { weightKg: 30000 }),
    ]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.offers.map((o: any) => o.id)).toEqual(['ok']);
    expect(res.matchCount).toBe(1);
  });

  it('stores no match count; sets lastSearchAt and moves OPEN to IN_PROGRESS', async () => {
    const { service, prisma } = makeService([offer('ok'), offer('zly', { pickupCountry: 'ES' })]);
    await service.searchOffers('dem-1', 'comp-1', 'user-1');

    const data = prisma.dispatcherDemand.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('matchCount');
    expect(data).toMatchObject({ status: 'IN_PROGRESS' });
    expect(data.lastSearchAt).toBeInstanceOf(Date);
  });

  it('returns the match count in the response', async () => {
    const { service } = makeService([offer('ok'), offer('zly', { pickupCountry: 'ES' })]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.matchCount).toBe(1);
  });

  it('reports how many offers were scanned', async () => {
    const { service } = makeService([offer('a'), offer('b', { pickupCountry: 'ES' })]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.scanned).toBe(2);
    expect(res.scanLimitReached).toBe(false);
  });

  it('signals that the scan limit was reached', async () => {
    const many = Array.from({ length: 500 }, (_, i) => offer(`o-${i}`));
    const { service } = makeService(many);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.scanLimitReached).toBe(true);
  });

  it('limits the result to 50 offers', async () => {
    const many = Array.from({ length: 120 }, (_, i) => offer(`o-${i}`));
    const { service } = makeService(many);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.offers).toHaveLength(50);
    expect(res.matchCount).toBe(50);
  });
});

describe('searchOffers — unknown criteria in the API response', () => {
  it('each offer carries its own list of unknown criteria', async () => {
    const { service } = makeService([offer('pelna'), offer('bez-masy', { weightKg: null })]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    const byId = Object.fromEntries(res.offers.map((o: any) => [o.id, o.matchUnknownCriteria]));
    expect(byId['pelna']).toEqual([]);
    expect(byId['bez-masy']).toEqual(['weight']);
  });

  it('the summary counts occurrences of each unknown criterion', async () => {
    const { service } = makeService([
      offer('a', { weightKg: null }),
      offer('b', { weightKg: null }),
      offer('c', { pickupCountry: null }),
      offer('d'),
    ]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.unknownCriteriaSummary).toEqual({ weight: 2, pickupCountry: 1 });
  });

  it('with complete data the summary is empty', async () => {
    const { service } = makeService([offer('a'), offer('b')]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.unknownCriteriaSummary).toEqual({});
  });

  it('does not count criteria of offers that were rejected anyway', async () => {
    const { service } = makeService([offer('odpada', { weightKg: null, pickupCountry: 'ES' })]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res.matchCount).toBe(0);
    expect(res.unknownCriteriaSummary).toEqual({});
  });

  it('keeps the contract fields the UI uses', async () => {
    const { service } = makeService([offer('a')]);
    const res: any = await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(res).toMatchObject({ demandId: 'dem-1', matchCount: 1 });
    expect(res.offers[0]).toMatchObject({ id: 'a', pickupCountry: 'PL' });
  });
});

describe('checkNewOfferAgainstDemands — returns unknown criteria', () => {
  it('returns an empty list for a match on complete data', async () => {
    const { service } = makeService([]);
    const res = await service.checkNewOfferAgainstDemands('comp-1', offer('a'));

    expect(res).toEqual([{ demandId: 'dem-1', unknownCriteria: [] }]);
  });

  it('reports the criterion for a match on incomplete data', async () => {
    const { service } = makeService([]);
    const res = await service.checkNewOfferAgainstDemands('comp-1', offer('a', { weightKg: null }));

    expect(res).toEqual([{ demandId: 'dem-1', unknownCriteria: ['weight'] }]);
  });

  it('returns nothing and creates no notification for a rejected offer', async () => {
    const { service, prisma } = makeService([]);
    const res = await service.checkNewOfferAgainstDemands('comp-1', offer('a', { pickupCountry: 'ES' }));

    expect(res).toEqual([]);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('creates a notification for a match', async () => {
    const { service, prisma } = makeService([]);
    await service.checkNewOfferAgainstDemands('comp-1', offer('a'));

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does not update the demand on a match', async () => {
    const { service, prisma } = makeService([]);
    await service.checkNewOfferAgainstDemands('comp-1', offer('a'));

    expect(prisma.dispatcherDemand.update).not.toHaveBeenCalled();
  });

  it('skips an offer whose status is outside the matching range', async () => {
    const { service, prisma } = makeService([]);
    const res = await service.checkNewOfferAgainstDemands('comp-1', offer('a', { status: 'COMPLETED' }));

    expect(res).toEqual([]);
    expect(prisma.dispatcherDemand.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});


describe('findAll — matchCount computed on read', () => {
  function makeList(demands: any[], offers: any[]) {
    const prisma: any = {
      dispatcherDemand: {
        findMany: jest.fn().mockResolvedValue(demands),
        count: jest.fn().mockResolvedValue(demands.length),
      },
      offer: { findMany: jest.fn().mockResolvedValue(offers) },
    };
    return { service: new DemandsService(prisma), prisma };
  }

  const dem = (id: string, over: Record<string, any> = {}) => ({ ...demand, id, ...over });

  it('each list item carries the number of currently matching offers', async () => {
    const { service } = makeList(
      [dem('d1'), dem('d2', { preferredCountries: ['ES'] })],
      [offer('o1'), offer('o2'), offer('o3', { pickupCountry: 'ES' })],
    );

    const res: any = await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(res.data.map((d: any) => [d.id, d.matchCount])).toEqual([
      ['d1', 2],
      ['d2', 1],
    ]);
  });

  it('loads offers once per page, not once per demand', async () => {
    const { service, prisma } = makeList([dem('d1'), dem('d2'), dem('d3')], [offer('o1')]);

    await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(prisma.offer.findMany).toHaveBeenCalledTimes(1);
  });

  it('only loads offers with statuses that qualify for matching', async () => {
    const { service, prisma } = makeList([dem('d1')], []);

    await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(prisma.offer.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'comp-1',
      status: { in: ['NEW', 'ASSIGNED'] },
    });
  });

  it('an empty page does not query offers', async () => {
    const { service, prisma } = makeList([], []);

    const res: any = await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(prisma.offer.findMany).not.toHaveBeenCalled();
    expect(res.data).toEqual([]);
  });

  it('no matching offers gives 0, not a missing field', async () => {
    const { service } = makeList([dem('d1', { preferredCountries: ['PT'] })], [offer('o1')]);

    const res: any = await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(res.data[0].matchCount).toBe(0);
  });

  it('keeps the paginated response shape the UI uses', async () => {
    const { service } = makeList([dem('d1')], [offer('o1')]);

    const res: any = await service.findAll('comp-1', { page: 1, limit: 20 } as any);

    expect(res.meta).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(res.data[0]).toMatchObject({ id: 'd1', title: 'Zapotrzebowanie' });
  });
});

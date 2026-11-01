/**
 * Saving a planner result with an offer (route_calculations).
 *
 * A row is the toll LTL and negotiation read, so it is saved only with a
 * complete toll from the registered provider, and only when the request names
 * an offer of the caller's company. The dispatcher's manual toll correction
 * (`offers.tollCostEstimate`) is never overwritten.
 *
 * No network: route adapter and toll provider are test doubles.
 */
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const ROUTE = {
  distance: 800_000,
  duration: 36_000,
  polyline: '',
  sections: [],
  countries: [{ countryCode: 'PL', distanceKm: 500 }, { countryCode: 'DE', distanceKm: 300 }],
};

const DTO: any = {
  origin: { lat: 52.23, lng: 21.01, address: 'Warszawa' },
  destination: { lat: 52.52, lng: 13.4, address: 'Berlin' },
  vehicle: { grossWeight: 40000, height: 4.0, width: 2.55, length: 16.5, axleCount: 5, euroClass: 'Euro6' },
};

function makeService(opts: { offer?: any; provider?: any } = {}) {
  const created: any[] = [];
  const prisma: any = {
    offer: { findFirst: jest.fn().mockResolvedValue(opts.offer ?? null), update: jest.fn(async () => ({})) },
    // The company cost per km (offer cost = rate × km + toll).
    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
    // findFirst — the offer margin is recomputed from the saved route.
    routeCalculation: { create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'rc-1', ...data }; }), findFirst: async () => created[created.length - 1] ?? null },
  };
  const adapter: any = { calculateRoute: jest.fn().mockResolvedValue([ROUTE]) };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  const provider = 'provider' in opts ? opts.provider : new FixedRateTollProvider();
  return { service: new RoutePlannerService(adapter, cache, prisma, provider), prisma, created };
}

const OFFER = { id: 'off-1' };

describe('saved only for an offer of the caller', () => {
  it('without offerId nothing is saved', async () => {
    const { service, prisma, created } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO }, 'comp-1');
    expect(created).toHaveLength(0);
    expect(prisma.offer.findFirst).not.toHaveBeenCalled();
  });

  it('without companyId nothing is saved, even with offerId', async () => {
    const { service, created } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' });
    expect(created).toHaveLength(0);
  });

  it('an offer of another company → NotFound, not a silent skip', async () => {
    const { service, created } = makeService({ offer: null });
    await expect(service.calculateRoute({ ...DTO, offerId: 'other' }, 'comp-1')).rejects.toThrow(/nie znaleziona/i);
    expect(created).toHaveLength(0);
  });

  it('ownership is checked by the companyId from the token', async () => {
    const { service, prisma } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    expect(prisma.offer.findFirst.mock.calls[0][0].where).toEqual({ id: 'off-1', companyId: 'comp-1' });
  });
});

describe('what is saved — the provider\'s toll', () => {
  const save = async () => {
    const { service, created } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    return created[0];
  };

  it('distance from the routed path, toll in EUR and PLN, the provider as the source', async () => {
    // Fake: PL 500 km × 0.40 PLN = 200 PLN = 46.00 EUR; DE 300 km × 0.20 EUR = 60 EUR.
    expect(await save()).toMatchObject({
      distanceKm: 800, tollTotalEur: 106, tollTotalPln: 460.87, tollSource: 'fake-fixed-rate',
      tollNeedsVerification: false, tollUnresolved: [],
    });
  });

  it('breakdown per country with the provider\'s amount and currency', async () => {
    expect((await save()).tollBreakdown.map((b: any) => [b.countryCode, b.amount, b.currency, b.costEUR])).toEqual([
      ['PL', 200, 'PLN', 46], ['DE', 60, 'EUR', 60],
    ]);
  });

  it('the route label is saved', async () => {
    expect(typeof (await save()).routeLabel).toBe('string');
  });
});

describe('nothing is saved without a complete toll', () => {
  it('no provider registered → no row (there is no toll to keep)', async () => {
    const { service, created } = makeService({ offer: OFFER, provider: null });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    expect(created).toHaveLength(0);
  });

  it('provider failure → 502 and no row', async () => {
    const { service, created } = makeService({ offer: OFFER, provider: new FixedRateTollProvider({ failWith: 'timeout' }) });
    await expect(service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1')).rejects.toMatchObject({ status: 502 });
    expect(created).toHaveLength(0);
  });

  it('an amount in a currency without a rate → incomplete → no row', async () => {
    const provider = new FixedRateTollProvider({ rates: { PL: { perKm: 1, currency: 'USD' }, DE: { perKm: 0.2, currency: 'EUR' } } });
    const { service, created } = makeService({ offer: OFFER, provider });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    expect(created).toHaveLength(0);
  });
});

describe('the dispatcher\'s manual correction survives a recalculation', () => {
  it('saving never touches offers.tollCostEstimate', async () => {
    const { service, prisma } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    // The planner recomputes the offer's cost and margin — only those fields,
    // never the manual toll.
    const updates = prisma.offer.update.mock.calls.map((c: any) => Object.keys(c[0].data).sort());
    expect(updates).toEqual([['marginWithoutTolls', 'profitEstimate', 'profitMarginPercent', 'totalCostEstimate']]);
  });

  it('no toll provider → no row and no margin recompute: the offer keeps an upper bound from its own km', async () => {
    const { service, prisma, created } = makeService({ offer: OFFER, provider: null });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1').catch(() => undefined);
    expect([created.length, prisma.offer.update.mock.calls.length]).toEqual([0, 0]);
  });

  it('two calculations → two rows (history, not overwrite)', async () => {
    const { service, created } = makeService({ offer: OFFER });
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    await service.calculateRoute({ ...DTO, offerId: 'off-1' }, 'comp-1');
    expect(created).toHaveLength(2);
  });
});

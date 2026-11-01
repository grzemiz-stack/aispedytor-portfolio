/**
 * The offer margin on save through offerCost (docs/decisions.md §3a).
 *
 * Before: the form, the import and the e-mail saved an offer without margin,
 * profit and total cost; older offers had a margin from the form's fuel and
 * toll. The dashboard average, sorting and the heuristic score took whatever
 * was there.
 * Now:
 *  - cost = `offerCost` (planner route, offer km, manual toll, company cost
 *    per km) in the offer currency; profit = price − cost; margin = profit /
 *    price. Computed on create (form, e-mail, import), on a change of price,
 *    currency, distance or manual toll, and after a planner route is saved;
 *  - without a toll (no route toll and no manual toll — also no toll
 *    provider) the margin is an upper bound — `marginWithoutTolls: true`;
 *    full → `false`; no margin → `null`;
 *  - the average margin from full margins only + the upper-bound count;
 *    sorting: full, then upper bounds, empty last;
 *  - the heuristic score: an upper bound ≥ 10 % → `uncertain`, scored like an
 *    unknown margin.
 */
import { TRUSTED_ROUTE } from '../../src/common/route-trust';
import { offerEconomics, NO_ECONOMICS, economicsWithRate, economicsFor } from '../../src/offers/offer-economics';
import { offerCost } from '../../src/common/offer-cost';
import { OffersService } from '../../src/offers/offers.service';
import { AiEvaluationService } from '../../src/ai-evaluation/ai-evaluation.service';

const PLN_RATE = { costPerKm: 4.2, costCurrency: 'PLN' };
const cost = (over: Partial<Parameters<typeof offerCost>[0]> = {}) =>
  offerCost({ route: null, offerDistanceKm: 300, manualToll: null, company: PLN_RATE, ...over });

describe('offerEconomics — the pure rule', () => {
  it('without a toll: the cost in the offer currency, profit, margin as an upper bound', () => {
    // 300 km × 4.20 PLN = 1260 PLN = 289.80 EUR; 1000 − 289.80 = 710.20; 71.02 %
    expect(offerEconomics(1000, 'EUR', cost())).toEqual({
      totalCostEstimate: 289.8, profitEstimate: 710.2, profitMarginPercent: 71.02, marginWithoutTolls: true,
    });
  });

  it('with a route toll: a full margin (marginWithoutTolls false)', () => {
    const e = offerEconomics(1000, 'EUR', cost({ route: { distanceKm: 300, tollEUR: 80 } }));
    expect([e.totalCostEstimate, e.marginWithoutTolls]).toEqual([369.8, false]);
  });

  it('with a manual toll: a full margin', () => {
    expect(offerEconomics(5000, 'PLN', cost({ manualToll: { amount: 344, currency: 'PLN' } }))).toEqual({
      totalCostEstimate: 1604, profitEstimate: 3396, profitMarginPercent: 67.92, marginWithoutTolls: false,
    });
  });

  it.each([
    ['no price', null, cost()],
    ['no company rate', 1000, cost({ company: { costPerKm: null, costCurrency: 'PLN' } })],
    ['no distance', 1000, cost({ offerDistanceKm: null })],
  ])('%s → nothing (all null), not a made-up number', (_n, price, c) => {
    expect(offerEconomics(price as any, 'EUR', c)).toEqual(NO_ECONOMICS);
  });

  it('a currency without a rate → nothing', () => {
    expect(offerEconomics(1000, 'XYZ', cost())).toEqual(NO_ECONOMICS);
  });

  it('a price of 0: cost and loss known, no margin (no division by zero)', () => {
    expect(offerEconomics(0, 'PLN', cost())).toEqual({ totalCostEstimate: 1260, profitEstimate: -1260, profitMarginPercent: null, marginWithoutTolls: null });
  });

  it('a price of 0 with a small cost (1 km, 4,20 PLN): still no margin — not −420 %', () => {
    expect(offerEconomics(0, 'PLN', cost({ offerDistanceKm: 1 })).profitMarginPercent).toBeNull();
  });

  it('a planner route without a toll quote (no toll provider, tollEUR null) → an upper bound, not a full margin', () => {
    const e = economicsWithRate({ price: 1000, currency: 'EUR', distanceKm: 250, tollCostEstimate: null }, PLN_RATE, { distanceKm: 300, tollEUR: null });
    expect([e.totalCostEstimate, e.marginWithoutTolls]).toEqual([289.8, true]);
  });

  it('economicsFor: a saved route row without a toll (null) stays "no toll" — not a toll of 0', async () => {
    const prisma: any = {
      company: { findUnique: async () => PLN_RATE },
      routeCalculation: { findFirst: async () => ({ distanceKm: 300, tollTotalEur: null }) },
    };
    const e = await economicsFor(prisma, 'c', { id: 'o1', price: 1000, currency: 'EUR', distanceKm: 250, tollCostEstimate: null });
    expect(e.marginWithoutTolls).toBe(true);
  });

  it('a margin outside DECIMAL(5,2) (±999,99) → no margin instead of a 500; cost and profit stay', () => {
    // 1 PLN at a cost of 1260 PLN → −125 900 %
    expect(offerEconomics(1, 'PLN', cost())).toEqual({ totalCostEstimate: 1260, profitEstimate: -1259, profitMarginPercent: null, marginWithoutTolls: null });
  });
});

// ── Where it is computed ────────────────────────────────────────────────────

const COMPANY = { costPerKm: 4.2, costCurrency: 'PLN' };
function service(opts: { route?: object | null; current?: object; company?: object | null } = {}) {
  const prisma: any = {
    company: { findUnique: jest.fn(async () => (opts.company === undefined ? COMPANY : opts.company)) },
    routeCalculation: { findFirst: jest.fn(async () => opts.route ?? null) },
    contractor: { findFirst: jest.fn(async () => null) },
    offer: {
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ id: 'o1', companyId: 'c', price: 1000, currency: 'EUR', distanceKm: 300, tollCostEstimate: null, pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', ...opts.current })),
      update: jest.fn(async ({ data }: any) => data),
      aggregate: jest.fn(async () => ({ _avg: { profitMarginPercent: 20 } })),
      count: jest.fn(async () => 3),
      groupBy: jest.fn(async () => []),
    },
  };
  const svc = new OffersService(prisma, { checkNewOfferAgainstDemands: async () => undefined } as any, { get: () => undefined, set: () => undefined, deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma };
}
const BODY = { pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', pickupDate: '2030-10-12', price: 1000, currency: 'EUR', distanceKm: 300 };
const econ = (d: any) => [d.totalCostEstimate, d.profitEstimate, d.profitMarginPercent, d.marginWithoutTolls];

describe('on save', () => {
  it('create (the form): the economics are stored', async () => {
    const { svc, prisma } = service();
    await svc.create('c', BODY as any);
    expect(econ(prisma.offer.create.mock.calls[0][0].data)).toEqual([289.8, 710.2, 71.02, true]);
  });

  it('create with a manual toll: a full margin', async () => {
    const { svc, prisma } = service();
    await svc.create('c', { ...BODY, tollCostEstimate: 80 } as any);
    expect(prisma.offer.create.mock.calls[0][0].data.marginWithoutTolls).toBe(false);
  });

  it('create without a company rate: nothing stored, no error', async () => {
    const { svc, prisma } = service({ company: { costPerKm: null, costCurrency: 'PLN' } });
    await svc.create('c', BODY as any);
    expect(econ(prisma.offer.create.mock.calls[0][0].data)).toEqual([null, null, null, null]);
  });

  it('edit: a new price recomputes with the stored planner route (km and toll from the route)', async () => {
    const { svc, prisma } = service({ route: { distanceKm: 300, tollTotalEur: 80 } });
    await svc.update('o1', 'c', { price: 2000 } as any);
    expect(econ(prisma.offer.update.mock.calls[0][0].data)).toEqual([369.8, 1630.2, 81.51, false]);
    // Without suspected fallback routes (common/route-trust.ts).
    expect(prisma.routeCalculation.findFirst.mock.calls[0][0].where).toEqual({ offerId: 'o1', ...TRUSTED_ROUTE });
  });

  it.each([
    ['currency', { currency: 'PLN' }],
    ['manual toll', { tollCostEstimate: 50 }],
    ['distance', { distanceKm: 400 }],
  ])('edit: a %s change recomputes', async (_n, dto) => {
    const { svc, prisma } = service();
    await svc.update('o1', 'c', dto as any);
    expect(prisma.offer.update.mock.calls[0][0].data.profitMarginPercent).not.toBeUndefined();
  });

  it('edit without a change to price, currency, distance or toll: the economics are not touched', async () => {
    const { svc, prisma } = service();
    await svc.update('o1', 'c', { notes: 'x', fuelCostEstimate: 10 } as any);
    const d = prisma.offer.update.mock.calls[0][0].data;
    expect(['totalCostEstimate', 'profitEstimate', 'profitMarginPercent', 'marginWithoutTolls'].filter((k) => k in d)).toEqual([]);
  });

  it('import: each inserted row carries its economics; the company is read once', async () => {
    const { svc, prisma } = service();
    const row = (i: number) => ({ externalId: `e${i}`, pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', pickupDate: '2030-10-12', price: 1000, currency: 'EUR', distanceKm: 300 });
    await svc.importOffers('c', { source: 'api', offers: [row(1), row(2)] } as any);
    const data = prisma.offer.createMany.mock.calls[0][0].data;
    expect(data.map(econ)).toEqual([[289.8, 710.2, 71.02, true], [289.8, 710.2, 71.02, true]]);
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('averages and sorting', () => {
  it('/offers/stats: the average from full margins only + the count with an upper bound only', async () => {
    const { svc, prisma } = service();
    const r: any = await svc.getStats('c');
    const avgCall = prisma.offer.aggregate.mock.calls.find((c: any) => c[0]._avg?.profitMarginPercent);
    expect(avgCall[0].where).toEqual({ companyId: 'c', profitMarginPercent: { not: null }, marginWithoutTolls: false });
    const countCall = prisma.offer.count.mock.calls.find((c: any) => c[0].where?.marginWithoutTolls === true);
    expect(countCall[0].where).toEqual({ companyId: 'c', profitMarginPercent: { not: null }, marginWithoutTolls: true });
    expect([r.avgMarginPercent, r.marginUpperBoundOffers]).toEqual([20, 3]);
  });

  it.each(['asc', 'desc'])('sorting by margin (%s): full, then upper bounds, empty last', async (dir) => {
    const { svc, prisma } = service();
    await svc.findAll('c', { page: 1, limit: 20, sortBy: 'profitMarginPercent', sortOrder: dir } as any);
    expect(prisma.offer.findMany.mock.calls[0][0].orderBy).toEqual([
      { marginWithoutTolls: { sort: 'asc', nulls: 'last' } },
      { profitMarginPercent: { sort: dir, nulls: 'last' } },
    ]);
  });
});

describe('the heuristic score', () => {
  const OFFER = { id: 'o1', companyId: 'c', pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', price: 1000, currency: 'EUR', pricePerKm: null, status: 'NEW' };
  const evaluate = (over: object) => new AiEvaluationService(
    { offer: { findFirst: async () => ({ ...OFFER, ...over }), findMany: async () => [] }, company: { findUnique: async () => null } } as any,
    { enqueue: (fn: any) => fn() } as any,
  ).evaluateOffer('o1', 'c') as Promise<any>;

  it('an upper bound of 25 % → "uncertain", scored like an unknown margin (not "excellent")', async () => {
    const [bound, unknown] = await Promise.all([
      evaluate({ profitMarginPercent: 25, marginWithoutTolls: true }),
      evaluate({ profitMarginPercent: null, marginWithoutTolls: null }),
    ]);
    expect([bound.marginRating, bound.score]).toEqual(['uncertain', unknown.score]);
  });

  it('an upper bound of 6 % → "fair" (the real margin is at most that), a full 25 % → "excellent"', async () => {
    expect((await evaluate({ profitMarginPercent: 6, marginWithoutTolls: true })).marginRating).toBe('fair');
    expect((await evaluate({ profitMarginPercent: 25, marginWithoutTolls: false })).marginRating).toBe('excellent');
  });
});

describe('the other places that create or change an offer', () => {
  it('the route planner: after saving a route for an offer, the offer economics are recomputed from that route', async () => {
    const { RoutePlannerService } = await import('../../src/route-planner/route-planner.service');
    const route = { distance: 300_000, duration: 12_000, polyline: '', sections: [], countries: [{ countryCode: 'DE', distanceKm: 300 }] };
    let saved: any = null;
    const prisma: any = {
      offer: {
        findFirst: jest.fn(async () => ({ id: 'off-1', price: 1000, currency: 'EUR', distanceKm: 250, tollCostEstimate: null })),
        update: jest.fn(async ({ data }: any) => data),
      },
      company: { findUnique: async () => COMPANY },
      routeCalculation: {
        create: jest.fn(async ({ data }: any) => { saved = data; return data; }),
        findFirst: jest.fn(async () => saved),
      },
    };
    const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
    // In this copy a route is saved only with a toll from a provider (src/tolls).
    const { FixedRateTollProvider } = await import('../fakes/fixed-rate-toll-provider');
    const svc = new RoutePlannerService({ calculateRoute: async () => [route] } as any, cache, prisma, new FixedRateTollProvider());
    await svc.calculateRoute({ origin: { lat: 52, lng: 16 }, destination: { lat: 52, lng: 13 }, vehicle: { axleCount: 5 }, offerId: 'off-1' } as any, 'c');
    const update = prisma.offer.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'off-1', companyId: 'c' });
    // 300 km from the route (not 250 from the offer) × 4.20 PLN + the route toll → a full margin.
    expect([update.data.marginWithoutTolls, update.data.totalCostEstimate > 289.8]).toEqual([false, true]);
    expect(cache.deleteByPrefix).toHaveBeenCalledWith('offers:c');
  });

  it('an offer from an e-mail carries the economics fields (no distance in an e-mail → empty, not a guess)', async () => {
    const { EmailAgentService } = await import('../../src/email-agent/email-agent.service');
    const email = {
      id: 'm1', companyId: 'c', subject: 'S', fromName: null, fromEmail: 'a@b.example.com', body: 'Fracht 1200 EUR',
      extractedPickupCity: 'A', extractedPickupCountry: 'PL', extractedDeliveryCity: 'B', extractedDeliveryCountry: 'DE',
      extractedWeight: null, extractedPrice: 1200, extractedDate: new Date('2030-10-12'), createdOfferId: null, llmExtractedData: { currency: 'EUR' },
    };
    const prisma: any = {
      emailMessage: { findFirst: async () => email, updateMany: async () => ({ count: 1 }) },
      offer: { create: jest.fn(async ({ data }: any) => ({ id: 'o', ...data })), findFirst: async () => null },
      company: { findUnique: async () => COMPANY },
      routeCalculation: { findFirst: async () => null },
    };
    prisma.$transaction = (fn: any) => fn(prisma);
    const svc = new EmailAgentService(prisma, { classify: () => ({}) } as any, { isAvailable: false } as any, { enqueue: (f: any) => f() } as any, { afterOfferCreated: () => undefined } as any);
    await svc.createOfferFromEmail('m1', 'c');
    expect(econ(prisma.offer.create.mock.calls[0][0].data)).toEqual([null, null, null, null]);
  });

  it('analytics: the average margin from full margins only + the upper-bound count', async () => {
    const { AnalyticsService } = await import('../../src/analytics/analytics.service');
    const prisma: any = {
      offer: {
        groupBy: async () => [], findMany: async () => [],
        aggregate: jest.fn(async () => ({ _avg: { profitMarginPercent: 12 } })),
        count: jest.fn(async () => 4),
      },
      company: { findUnique: async () => ({ costCurrency: 'PLN' }) },
    };
    const r: any = await new AnalyticsService(prisma, { get: () => undefined, set: () => undefined } as any).getMarketOverview('c');
    expect(prisma.offer.aggregate.mock.calls[0][0].where).toEqual({ companyId: 'c', profitMarginPercent: { not: null }, marginWithoutTolls: false });
    expect(prisma.offer.count.mock.calls.some((c: any) => c[0].where?.marginWithoutTolls === true)).toBe(true);
    expect([r.avgMargin, r.marginUpperBoundOffers]).toEqual([12, 4]);
  });
});

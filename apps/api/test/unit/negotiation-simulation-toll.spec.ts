/**
 * simulateNegotiation — price scenarios without a toll approximation of its own.
 *
 * The simulator uses the same source as the cost argument:
 * manual entry > route_calculations > none.
 *
 * The cost = the company cost per km × km + toll (common/offer-cost.ts).
 * Without a route and without a manual toll (also with no toll provider) the
 * scenarios ARE computed, but the cost is without tolls: a lower bound, the
 * margins upper bounds ("at most"), and `uncertain` replaces excellent / good /
 * acceptable (a toll left out inflates the margin — the dispatcher must not get
 * a promise without cover). Without a cost (no company cost per km, no
 * distance) there are no scenarios, with an explicit reason and action.
 */
import { NegotiationService } from '../../src/negotiation/negotiation.service';

const BASE_OFFER = {
  id: 'off-1',
  companyId: 'comp-1',
  pickupCity: 'Warszawa',
  deliveryCity: 'Berlin',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pickupDate: new Date('2026-10-01'),
  distanceKm: 800,
  price: 4000,
  currency: 'PLN',
  weightKg: 24000,
  cargoType: 'Palety',
  isAdr: false,
  tollCostEstimate: null,
  contractorId: null,
  contractor: null,
  analysis: null,
};

const ROUTE_CALCULATION = {
  id: 'rc-1',
  offerId: 'off-1',
  distanceKm: 812,
  tollTotalEur: 118.5,
  tollTotalPln: 509.55, // written at a fixed 4.30 rate and not read: negotiation converts tollTotalEur through common/fx
  tollBreakdown: [{ countryCode: 'PL', distanceKm: 300, costEUR: 33 }],
  tollUnresolved: [],
  tollNeedsVerification: false,
  routeLabel: 'najtańsza',
  calculatedAt: new Date('2026-09-08T10:00:00.000Z'),
};

/** `provider: true` — a TollProvider is registered (route not calculated yet ≠ no provider). */
function makeService(opts: { oferta?: Record<string, any>; wyliczenie?: any; provider?: boolean } = {}) {
  const offerRecord = { ...BASE_OFFER, ...(opts.oferta ?? {}) };
  const prisma: any = {
    offer: {
      findFirst: jest.fn().mockResolvedValue(offerRecord),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _avg: {}, _min: {}, _max: {}, _count: { id: 0 } }),
    },
    contractor: { findFirst: jest.fn().mockResolvedValue(null) },
    // The company cost per km (offer cost = rate × km + toll).
    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
    routeCalculation: { findFirst: jest.fn().mockResolvedValue(opts.wyliczenie ?? null) },
  };
  const service = new NegotiationService(prisma, opts.provider ? ({ quote: jest.fn() } as any) : null);
  (service as any).getPriceSuggestion = jest.fn().mockResolvedValue({
    avgPrice: 4500, optimalPrice: 4500, minPrice: 4000, maxPrice: 5000,
    medianPrice: 4500, confidence: 50, sampleSize: 10,
    percentiles: { p25: 4200, p50: 4500, p75: 4800 },
  });
  return { service, prisma };
}

const runSimulation = (s: any, simulatedPrice = 4200) =>
  s.simulateNegotiation('off-1', simulatedPrice, 'comp-1') as Promise<any>;

describe('the simulator takes toll from the same source as the analysis', () => {
  it('uses the route planner calculation when there is one', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service);

    // `tollCost` carries the exact amount, `estimatedCosts` rounds to whole
    // zloty — like the other cost items in this response.
    expect(r.tollCost.source).toBe('calculated');
    expect(r.tollCost.amountPLN).toBe(515.22); // 118.50 / 0.23 (the PLN column, 509.55, is not read)
    expect(r.estimatedCosts.tollPLN).toBe(515); // 515.22 rounded
  });

  it('the manual entry takes precedence over the calculation', async () => {
    const { service } = makeService({
      oferta: { tollCostEstimate: 600 },
      wyliczenie: ROUTE_CALCULATION,
    });

    const r = await runSimulation(service);

    expect(r.tollCost.source).toBe('manual');
    expect(r.tollCost.amountPLN).toBe(600);
    expect(r.estimatedCosts.tollPLN).toBe(600);
  });

  it('cost = the company cost per km × route km + route toll (812 km × 4.20 PLN + 515.22 PLN)', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service);

    expect(r.estimatedCosts).toEqual({ perKmPLN: 3410, tollPLN: 515, totalPLN: 3926, source: 'route', withoutTolls: false, messages: [] });
    expect(r.costIsLowerBound).toBe(false);
  });
});

describe('no route and no toll — a cost without tolls, margins as upper bounds', () => {
  it('scenarios are there; the cost is offer km × the company rate (800 × 4.20), without tolls, with the codes', async () => {
    const { service } = makeService({ provider: true });

    const r = await runSimulation(service);

    expect([r.available, r.unavailable, r.costIsLowerBound]).toEqual([true, null, true]);
    expect(r.estimatedCosts).toEqual({
      perKmPLN: 3360, tollPLN: null, totalPLN: 3360, source: 'company_rate', withoutTolls: true,
      messages: [{ code: 'OFFER_COST_ESTIMATED' }, { code: 'OFFER_COST_WITHOUT_TOLLS' }],
    });
  });

  it('a margin above 8 % without tolls gets no excellent / good / acceptable verdict — only uncertain', async () => {
    const { service } = makeService({ provider: true });

    const r = await runSimulation(service, 5000);
    const contractor = r.scenarios.find((x: any) => x.label === 'Cena kontrahenta');

    // 4000 PLN − 3360 PLN = 16.0 % — at most
    expect([contractor.marginPct, contractor.verdict]).toEqual([16, 'uncertain']);
    expect(r.scenarios.filter((x: any) => ['excellent', 'good', 'acceptable'].includes(x.verdict))).toEqual([]);
  });

  it('an upper bound below the threshold decides: low or loss stay', async () => {
    const { service } = makeService({ provider: true });

    const loss = (await runSimulation(service, 3000)).scenarios.find((x: any) => x.label === 'Twoja propozycja');
    // "-10% od oferty" = 3600 PLN; 3600 − 3360 = 240 PLN → at most 6.7 % (< 8 %) — surely low.
    const low = (await runSimulation(service, 3000)).scenarios.find((x: any) => x.label === '-10% od oferty');

    expect([loss.verdict, low.marginPct, low.verdict]).toEqual(['loss', 6.7, 'low']);
  });
});

describe('without a cost — no scenarios, but a reason and an action', () => {
  const noRate = () => {
    const m = makeService();
    m.prisma.company.findUnique.mockResolvedValue({ costPerKm: null, costCurrency: 'PLN' });
    return m;
  };

  it('a company without a cost per km → unavailable, OFFER_COST_RATE_MISSING, the action "set the cost per km"', async () => {
    const r = await runSimulation(noRate().service);

    expect([r.available, r.unavailable.reason, r.unavailable.code]).toEqual([false, 'cost_unknown', { code: 'OFFER_COST_RATE_MISSING' }]);
    expect(r.unavailable.actions).toEqual([{ code: 'set_cost_per_km', label: 'Ustaw koszt kilometra firmy', offerId: 'off-1' }]);
  });

  it('unknown costs are null, not zero; breakEven and sweetSpot too', async () => {
    const r = await runSimulation(noRate().service);

    expect([r.scenarios, r.estimatedCosts.totalPLN, r.estimatedCosts.tollPLN, r.breakEvenPrice, r.sweetSpotRange]).toEqual([[], null, null, null, { min: null, max: null }]);
  });

  it('no distance and no coordinates → unavailable, OFFER_COST_NO_DISTANCE, the calculate-route action with offerId', async () => {
    const { service } = makeService({ oferta: { distanceKm: null, pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null } });

    const r = await runSimulation(service);

    expect([r.available, r.unavailable.code]).toEqual([false, { code: 'OFFER_COST_NO_DISTANCE' }]);
    expect(r.unavailable.actions).toEqual([{ code: 'calculate_route', label: 'Policz trase w planerze', offerId: 'off-1' }]);
  });
});

describe('with a known toll the verdicts stay full (not uncertain)', () => {
  it('5000 PLN at a cost of 3926 PLN → 21.5 % → excellent', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service, 5000);
    const proposal = r.scenarios.find((x: any) => x.label === 'Twoja propozycja');

    expect([proposal.marginPct, proposal.verdict, r.costIsLowerBound]).toEqual([21.5, 'excellent', false]);
  });
});

describe('when toll is known, the simulator computes scenarios', () => {
  it('available is true and scenarios are not empty', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service);

    expect(r.available).toBe(true);
    expect(r.unavailable).toBeNull();
    expect(r.scenarios.length).toBeGreaterThan(0);
  });

  it('the "Cena kontrahenta" (contractor price) scenario is present', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service);

    expect(r.scenarios.some((s: any) => s.label === 'Cena kontrahenta')).toBe(true);
  });

  it('breakEven and sweetSpot are numbers', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runSimulation(service);

    expect(typeof r.breakEvenPrice).toBe('number');
    expect(typeof r.sweetSpotRange.min).toBe('number');
  });
});

describe('no toll provider registered and no manual toll', () => {
  it('the simulation counts without tolls (an upper bound), not unavailable', async () => {
    const { service } = makeService();
    const r = await runSimulation(service);
    expect([r.available, r.costIsLowerBound, r.estimatedCosts.withoutTolls, r.estimatedCosts.tollPLN]).toEqual([true, true, true, null]);
  });

  it('a manual toll is part of the cost (it is the dispatcher\'s number)', async () => {
    const { service } = makeService({ oferta: { tollCostEstimate: 600 } });
    const r = await runSimulation(service);
    expect([r.available, r.estimatedCosts.tollPLN, r.estimatedCosts.withoutTolls]).toEqual([true, 600, false]);
  });
});

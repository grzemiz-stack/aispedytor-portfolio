/**
 * Negotiation does not compute toll itself.
 *
 * The amount comes from outside, in a fixed order of precedence:
 *
 *   1. the dispatcher's manual entry       — Offer.tollCostEstimate
 *   2. the latest route planner calculation — route_calculations
 *   3. "unknown"                           — explicit, not a silently missing block
 *
 * Without the third state the whole cost argument would disappear, which
 * reads as "no reason to warn about the margin". Toll is not split from the
 * distance by country (e.g. 30% pickup country, 30% delivery country): that
 * loses transit countries.
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
  pricePerKm: 5,
  weightKg: 24000,
  cargoType: 'Palety',
  isAdr: false,
  tollCostEstimate: null,
  contractorId: null,
  contractor: null,
  analysis: null,
};

/** A route planner calculation as stored in route_calculations. */
const ROUTE_CALCULATION = {
  id: 'rc-1',
  offerId: 'off-1',
  distanceKm: 812,
  tollTotalEur: 118.5,
  tollTotalPln: 509.55, // written at a fixed 4.30 rate and not read: negotiation converts tollTotalEur through common/fx
  tollBreakdown: [
    { countryCode: 'PL', distanceKm: 300, rateEurPerKm: 0.11, costEUR: 33 },
    { countryCode: 'CZ', distanceKm: 200, rateEurPerKm: 0.14, costEUR: 28 },
    { countryCode: 'DE', distanceKm: 312, rateEurPerKm: 0.19, costEUR: 57.5 },
  ],
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
    routeCalculation: {
      findFirst: jest.fn().mockResolvedValue(opts.wyliczenie ?? null),
    },
  };
  const service = new NegotiationService(prisma, opts.provider ? ({ quote: jest.fn() } as any) : null);
  (service as any).getPriceSuggestion = jest.fn().mockResolvedValue({
    avgPrice: 4500, optimalPrice: 4500, minPrice: 4000, maxPrice: 5000,
    medianPrice: 4500, confidence: 50, sampleSize: 10,
    percentiles: { p25: 4200, p50: 4500, p75: 4800 },
  });
  return { service, prisma };
}

const runAnalysis = (s: any) => s.analyzeOffer('off-1', 'comp-1') as Promise<any>;

describe('state 1 — the manual entry takes precedence', () => {
  it('with a manual entry, it is the source of the amount even when a calculation exists', async () => {
    const { service } = makeService({
      oferta: { tollCostEstimate: 600 },
      wyliczenie: ROUTE_CALCULATION,
    });

    const r = await runAnalysis(service);

    expect(r.tollCost.source).toBe('manual');
    expect(r.tollCost.amountPLN).toBe(600);
  });

  it('the amount is marked as entered by the user', async () => {
    const { service } = makeService({ oferta: { tollCostEstimate: 600 } });

    const r = await runAnalysis(service);

    expect(r.tollCost.enteredByUser).toBe(true);
  });

  it('a manual entry of 0 is a value, not a missing one', async () => {
    const { service } = makeService({ oferta: { tollCostEstimate: 0 } });

    const r = await runAnalysis(service);

    expect(r.tollCost.source).toBe('manual');
    expect(r.tollCost.amountPLN).toBe(0);
  });
});

describe('state 2 — route planner calculation', () => {
  it('without a manual entry the amount comes from the calculation (EUR through fx)', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runAnalysis(service);

    expect(r.tollCost.source).toBe('calculated');
    expect(r.tollCost.amountPLN).toBe(515.22); // 118.50 / 0.23 (the PLN column, 509.55, is not read)
  });

  it('carries the per-country breakdown, not just the total', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runAnalysis(service);

    expect(r.tollCost.breakdown.map((b: any) => b.countryCode)).toEqual(['PL', 'CZ', 'DE']);
  });

  it('carries the calculation date and the stale-rates flag', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runAnalysis(service);

    expect(r.tollCost.calculatedAt).toBe('2026-09-08T10:00:00.000Z');
    expect(r.tollCost.needsVerification).toBe(false);
  });

  it('reads the LATEST calculation', async () => {
    const { service, prisma } = makeService({ wyliczenie: ROUTE_CALCULATION });

    await runAnalysis(service);

    expect(prisma.routeCalculation.findFirst.mock.calls[0][0]).toMatchObject({
      where: { offerId: 'off-1' },
      orderBy: { calculatedAt: 'desc' },
    });
  });
});

describe('state 3 — unknown, explicitly', () => {
  it('without a manual entry or a calculation the state is unknown', async () => {
    const { service } = makeService();

    const r = await runAnalysis(service);

    expect(r.tollCost.source).toBe('unknown');
    expect(r.tollCost.amountPLN).toBeNull();
  });

  it('with a provider but no calculated route, the cost argument stays: toll unknown, the margin an upper bound', async () => {
    // Without this argument the block would disappear, which reads as "no reason to warn".
    // The cost = the company rate × km without tolls: 800 km × 4.20 PLN = 3360 PLN at 4000 PLN → at most 16.0 %.
    const { service } = makeService({ provider: true });

    const r = await runAnalysis(service);
    const arg = r.arguments.find((a: any) => a.type === 'cost');

    expect(arg.title).toBe('Marża niepewna — bez myta');
    expect(arg.text).toMatch(/co najwyzej 16\.0%/);
    expect(arg.text).toMatch(/Myto nieznane/);
  });

  it('no distance and no calculation: state unknown and the cost argument is still there', async () => {
    const { service } = makeService({ oferta: { distanceKm: null } });

    const r = await runAnalysis(service);

    expect(r.tollCost.source).toBe('unknown');
    expect(r.arguments.find((a: any) => a.type === 'cost')).toBeDefined();
  });
});

describe('both numbers at once — the difference is information, not an error', () => {
  it('when both exist, the result carries the calculated amount too', async () => {
    const { service } = makeService({
      oferta: { tollCostEstimate: 600 },
      wyliczenie: ROUTE_CALCULATION,
    });

    const r = await runAnalysis(service);

    expect(r.tollCost.amountPLN).toBe(600);
    expect(r.tollCost.calculatedAmountPLN).toBe(515.22); // 118.50 / 0.23; the PLN column (509.55) is not read
  });

  it('the difference is computed and returned', async () => {
    const { service } = makeService({
      oferta: { tollCostEstimate: 600 },
      wyliczenie: ROUTE_CALCULATION,
    });

    const r = await runAnalysis(service);

    expect(r.tollCost.differencePLN).toBeCloseTo(84.78, 2); // 600 − 515.22
  });

  it('a manual entry alone gives no difference', async () => {
    const { service } = makeService({ oferta: { tollCostEstimate: 600 } });

    const r = await runAnalysis(service);

    expect(r.tollCost.calculatedAmountPLN).toBeNull();
    expect(r.tollCost.differencePLN).toBeNull();
  });
});

describe('no transit-country disclaimer', () => {
  it('with a calculated route, the cost argument (if any) does not mention transit countries', async () => {
    const { service } = makeService({ wyliczenie: ROUTE_CALCULATION });

    const r = await runAnalysis(service);
    const arg = r.arguments.find((a: any) => a.type === 'cost');

    expect(arg?.text ?? '').not.toMatch(/kraje tranzytowe nie sa uwzglednione|tranzyt/i);
  });
});

it('no toll provider: the cost argument says toll is not computed, not "calculate the route"', async () => {
  const { service } = makeService();
  const arg = (await runAnalysis(service)).arguments.find((a: any) => a.type === 'cost');
  expect(arg.text).toMatch(/brak dostawcy myta/);
  expect(arg.text).not.toMatch(/Policz trase/);
});

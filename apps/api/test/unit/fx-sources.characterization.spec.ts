/**
 * Characterization test: negotiation numbers converted through common/fx.
 *
 * Written before negotiation moved to the single rate source
 * (docs/decisions.md §4). Every number that changed with that move is shown
 * as "before: …" next to the new expectation, so it is visible that the
 * numbers changed only because of the rate.
 *
 * Before, negotiation used a fixed 4.30 and only EUR↔PLN: an offer of
 * 1000 GBP was counted as 1000 PLN (margin −162 %), and the price history and
 * the contractor rate mixed GBP with PLN/EUR without a rate. A currency
 * without a rate now gives no amount, with a code (as in the LTL ranking).
 * The planner, OSRM crossing and country toll table parts were removed: toll
 * amounts come only from a toll provider (src/tolls).
 *
 * By hand: toll row 129.50 EUR (PL 300 × 0.085 + DE 500 × 0.208) / 0.23 =
 * 563.04 PLN; EUR offer: cost 8 × 32 × 6.50 + 563.04 + 400 = 2627.04 PLN
 * × 0.23 = 604 (break-even).
 */
import { NegotiationService } from '../../src/negotiation/negotiation.service';

// ── A. route-planner.service.ts ─────────────────────────────────────────────
// Toll now comes only from a TollProvider (src/tolls); the planner's fx use
// (provider amounts → EUR/PLN, fuel, margin in the freight's currency) is
// covered by route-save.spec.ts, route-planner.alternatives.spec.ts and
// route-planner.helpers.spec.ts.

// ── B, C. OSRM crossings and country toll tables — removed (toll amounts come
// only from the TollProvider, src/tolls).

// ── D. negotiation.service.ts ───────────────────────────────────────────────

describe('D — negotiation: common/fx for every currency (before: 4.30 and only EUR↔PLN)', () => {
  const day = (n: number) => new Date(Date.now() - n * 86400000);
  let HISTORY: any[] = [];
  const BASE_HISTORY = [
    { price: 1000, currency: 'EUR', distanceKm: 800, pricePerKm: 1.25, createdAt: day(5) },
    { price: 4300, currency: 'PLN', distanceKm: 800, pricePerKm: 5.375, createdAt: day(10) },
    { price: 900, currency: 'GBP', distanceKm: 800, pricePerKm: 1.125, createdAt: day(15) },
  ];
  beforeEach(() => { HISTORY = [...BASE_HISTORY]; });
  const BASE = {
    id: 'o1', pickupCity: 'Poznań', deliveryCity: 'Berlin', pickupCountry: 'PL', deliveryCountry: 'DE',
    distanceKm: 800, tollCostEstimate: null, contractorId: 'k', pickupDate: new Date('2026-10-10'),
    cargoType: 'x', isAdr: false, weightKg: 1000, pricePerKm: null,
  };

  /** Fake database: offer, history, contractor, and a route_calculations row with 129.50 EUR (its PLN column, 556.85 = 129.50 × 4.30, is not read). */
  function service(offer: any): any {
    return new NegotiationService({
      offer: {
        findFirst: async () => offer,
        findMany: async (a: any) => (a.where.contractorId
          ? HISTORY.map(({ price, currency, distanceKm }) => ({ price, currency, distanceKm }))
          : HISTORY),
        count: async () => 3,
        aggregate: async () => ({ _avg: { price: 2000 } }),
      },
      // The company cost per km (offer cost = rate × km + toll).
      company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
      routeCalculation: {
        findFirst: async () => ({
          // A row saved at the old 4.30 rate: EUR 129.50 and PLN 556.85. Negotiation reads the EUR amount.
          distanceKm: 800, tollTotalEur: 129.5, tollTotalPln: 556.85, tollBreakdown: [], tollUnresolved: [],
          calculatedAt: new Date('2026-10-01'), tollNeedsVerification: false,
        }),
      },
      contractor: { findFirst: async () => ({ id: 'k', name: 'K', totalOrders: 3, paymentRating: 4, reliabilityScore: 80, avgPaymentDays: 30 }) },
    } as any);
  }
  const offer = (currency: string, price: number) => ({ ...BASE, currency, price });
  const simulate = async (currency: string, price: number) => {
    const s = await service(offer(currency, price)).simulateNegotiation('o1', price, 'c');
    return {
      breakEven: s.breakEvenPrice, sweet: s.sweetSpotRange, costs: s.estimatedCosts,
      scenarios: s.scenarios.map((x: any) => [x.label, x.price, x.marginPLN, x.marginPct]),
    };
  };
  // Toll from the planner row: 129.50 EUR / 0.23 = 563.04 PLN (before: the PLN column, 556.85 at 4.30).
  // The cost = 800 km × 4.20 PLN (the company cost per km) + toll 563.04 PLN = 3923.04 PLN.
  // Before: fuel 1664 + toll 563 + "other" 400 = 2627.
  const COSTS = { perKmPLN: 3360, tollPLN: 563, totalPLN: 3923, source: 'route', withoutTolls: false, messages: [] };

  it('simulation, EUR offer: prices to PLN and break-even back through fx', async () => {
    // Before common/fx: break-even 610, sweet 693–762, toll 557, scenarios 2539/49.2 … 663/230/8.1.
    expect(await simulate('EUR', 1200)).toEqual({
      // 3923.04 PLN × 0.23 = 902.30 EUR; /0.88 and /0.8 → 1025 / 1128 (before: 604, 687–755).
      breakEven: 902, sweet: { min: 1025, max: 1128 }, costs: COSTS,
      scenarios: [
        ['Cena kontrahenta', 1200, 1294, 24.8],
        ['-5% od oferty', 1140, 1033, 20.9],
        ['-10% od oferty', 1080, 773, 16.5],
        ['Optymalna rynkowa', 1000, 425, 9.8],
        ['Minimalna akceptowalna', 981, 342, 8],
      ],
    });
  });

  it('simulation, PLN offer: only the toll and the history change by the rate', async () => {
    // Before common/fx: break-even 2621, sweet 2978–3276, optimal 4300 (EUR × 4.30).
    expect(await simulate('PLN', 5000)).toEqual({
      breakEven: 3923, sweet: { min: 4458, max: 4904 }, costs: COSTS,
      scenarios: [
        ['Cena kontrahenta', 5000, 1077, 21.5],
        ['-5% od oferty', 4750, 827, 17.4],
        ['-10% od oferty', 4500, 577, 12.8],
        ['Optymalna rynkowa', 4348, 425, 9.8],
        ['Minimalna akceptowalna', 4264, 341, 8],
      ],
    });
  });

  it('simulation, GBP offer: 1000 GBP = 5000 PLN, break-even in GBP', async () => {
    // Before common/fx (WRONG): 1000 GBP counted as 1000 PLN — margin −162.1 %, break-even 2621 "GBP".
    expect(await simulate('GBP', 1000)).toEqual({
      // 3923.04 PLN × 0.2 = 784.61 GBP (before: 525).
      breakEven: 785, sweet: { min: 892, max: 981 }, costs: COSTS,
      scenarios: [
        ['Cena kontrahenta', 1000, 1077, 21.5],
        ['-5% od oferty', 950, 827, 17.4],
        ['-10% od oferty', 900, 577, 12.8],
        ['Optymalna rynkowa', 870, 427, 9.8],
        ['Minimalna akceptowalna', 853, 342, 8],
      ],
    });
  });

  it('simulation gives the panel the rate it used (PLN per unit of the offer currency)', async () => {
    const rate = async (c: string, p: number) => (await service(offer(c, p)).simulateNegotiation('o1', p, 'c')).rateToPLN;
    expect(await rate('PLN', 5000)).toBe(1);
    expect(await rate('EUR', 1200)).toBeCloseTo(1 / 0.23, 10); // before common/fx: the panel multiplied by 4.3
    expect(await rate('GBP', 1000)).toBeCloseTo(5, 10);         // before common/fx: the panel did not convert
    expect(await rate('USD', 1000)).toBeNull();
  });

  it('simulation, offer in a currency without a rate: unavailable, with the code', async () => {
    const s = await service(offer('USD', 1000)).simulateNegotiation('o1', 1000, 'c');
    expect(s).toMatchObject({ available: false, scenarios: [], breakEvenPrice: null });
    expect(s.unavailable).toMatchObject({
      reason: 'currency_unconvertible',
      code: { code: 'CURRENCY_CONVERSION_UNAVAILABLE', params: { from: 'USD', to: 'PLN' } },
    });
  });

  const pick = (p: any) => [p.minPrice, p.maxPrice, p.avgPrice, p.medianPrice, p.avgPricePerKm];
  const suggestion = (currency: string, price: number) => service(offer(currency, price)).getPriceSuggestion(offer(currency, price), 800, 'c');

  it('price history in the offer currency through fx — every currency', async () => {
    // EUR: 1000, 4300 × 0.23 = 989, 900 × 1.15 = 1035.  Before: [900, 1000, 967, 1000, 1.21] (GBP as EUR).
    expect(pick(await suggestion('EUR', 1200))).toEqual([989, 1035, 1008, 1000, 1.26]);
    // PLN: 1000 / 0.23 = 4348, 4300, 900 × 5 = 4500.  Before: [900, 4300, 3167, 4300, 3.96] (GBP as PLN).
    expect(pick(await suggestion('PLN', 5000))).toEqual([4300, 4500, 4383, 4348, 5.48]);
    // GBP: 869.57, 860, 900.  Before: [900, 4300, 2067, 1000, 2.58] (nothing converted).
    expect(pick(await suggestion('GBP', 1000))).toEqual([860, 900, 877, 870, 1.1]);
  });

  it('history price in a currency without a rate is left out and counted, not added raw', async () => {
    HISTORY.push({ price: 999, currency: 'USD', distanceKm: 800, pricePerKm: 1.25, createdAt: day(3) });
    const p = await suggestion('EUR', 1200);
    expect(pick(p)).toEqual([989, 1035, 1008, 1000, 1.26]);
    expect(p.historicalCount).toBe(3);
    expect(p.messages).toContainEqual({ code: 'TOTAL_EXCLUDES_UNCONVERTED', params: { count: 1, from: 'USD', to: 'EUR' } });
  });

  it('no history: per-km estimate — EUR 1.15, PLN 4.95, GBP from 1.15 EUR through fx, no rate → 0 with the code', async () => {
    HISTORY = [];
    const perKm = async (c: string) => (await suggestion(c, 1000)).avgPricePerKm;
    expect(await perKm('EUR')).toBe(1.15);
    expect(await perKm('PLN')).toBe(4.95);
    expect(await perKm('GBP')).toBeCloseTo(1.0, 10); // 1.15 EUR / 1.15; before common/fx: 4.95 ("PLN" as GBP)
    const usd = await suggestion('USD', 1000);
    expect([usd.avgPricePerKm, usd.avgPrice]).toEqual([0, 0]);
    expect(usd.messages).toEqual([{ code: 'CURRENCY_CONVERSION_UNAVAILABLE', params: { from: 'EUR', to: 'USD' } }]);
    expect((await suggestion('GBP', 1000)).messages).toEqual([{ code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'GBP', rate: 0.8696 } }]);
  });

  it('contractor rate per km and market average in PLN through fx', async () => {
    // (4347.83 + 4300 + 4500) / 800 / 3 = 5.48 PLN/km (before: 3.96 — GBP as PLN).
    // The market comparison on similar routes needs 5 market offers — here 3,
    // so there is no comparison (before: "market" 0 % from average amounts).
    const k = await service(offer('PLN', 5000)).getContractorAnalysis('k', 'c', offer('PLN', 5000), 800);
    expect([k.avgRate, k.priceVsMarket, k.priceVsMarketPct]).toEqual([5.48, null, null]);
    expect(k.messages.map((m: any) => m.code)).toContain('NEGOTIATION_SAMPLE_TOO_SMALL');
  });

  it('low-margin argument: GBP offer converted (none); currency without a rate → no argument', async () => {
    const lowMargin = async (currency: string, price: number) => {
      const s = service(offer(currency, price));
      const o = offer(currency, price);
      const args = s.getNegotiationArguments(o, 800, await s.getPriceSuggestion(o, 800, 'c'), null, await s.resolveTollCost(o), await s.offerCostOf(o, 800, 'c'));
      return args.filter((a: any) => a.title === 'Niska marża').length;
    };
    expect(await lowMargin('EUR', 1200)).toBe(0);
    expect(await lowMargin('GBP', 1000)).toBe(0); // before common/fx: an argument with margin −122.1 %
    expect(await lowMargin('USD', 1000)).toBe(0);
  });
});

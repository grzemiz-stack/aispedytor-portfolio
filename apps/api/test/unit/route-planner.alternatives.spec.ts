/**
 * RoutePlannerService — building route alternatives, labels and the recommendation.
 *
 * buildRouteAlternative() is pure: it takes a ready route object and returns the
 * computed alternative (fuel + toll + margin). None of these tests touch the network.
 */
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { MemoryCacheService } from '../../src/common/cache/memory-cache.service';
import type { PlannedRoute, RouteSection } from '../../src/route-planner/route-types';

function section(countryCode: string, km: number, minutes: number): RouteSection {
  return {
    id: `s-${countryCode}`,
    type: 'vehicle',
    distance: km * 1000,
    duration: minutes * 60,
    polyline: `poly-${countryCode}`,
    countryCode,
  };
}

function route(sections: RouteSection[]): PlannedRoute {
  return {
    distance: sections.reduce((s, x) => s + x.distance, 0),
    duration: sections.reduce((s, x) => s + x.duration, 0),
    polyline: 'poly-full',
    sections,
    countries: sections.map(x => ({ countryCode: x.countryCode!, distanceKm: x.distance / 1000 })),
  };
}

describe('RoutePlannerService — buildRouteAlternative', () => {
  let service: RoutePlannerService;
  let cache: MemoryCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService();
    service = new RoutePlannerService(null as any, cache, null as any);
  });
  afterEach(() => cache.onModuleDestroy());

  /** Toll as a provider would return it: PL 25.50 EUR, DE 104 EUR (arbitrary test amounts). */
  const QUOTE = {
    source: 'test',
    items: [
      { countryCode: 'PL', amount: 25.5, currency: 'EUR' },
      { countryCode: 'DE', amount: 104, currency: 'EUR' },
    ],
  };

  // The company cost per km: the route cost = rate × km + toll; there is no fuel.
  const COMPANY = { costPerKm: 4.2, costCurrency: 'PLN' };
  const build = (r: PlannedRoute, opts: Partial<{
    index: number; quote: any; company: { costPerKm: number | null; costCurrency: string }; currency: string; rate?: number;
  }> = {}) =>
    (service as any).buildRouteAlternative(
      r,
      opts.index ?? 0,
      service.tollCostsFromQuote('quote' in opts ? opts.quote : QUOTE, r),
      opts.company ?? COMPANY,
      opts.currency ?? 'EUR',
      opts.rate,
    );

  // PL 300 km + DE 500 km
  const trip = route([section('PL', 300, 240), section('DE', 500, 360)]);

  it('sums distance and duration of the sections', () => {
    const alt = build(trip);
    expect(alt.distanceKm).toBe(800);
    expect(alt.durationMin).toBe(600);
    expect(alt.durationFormatted).toBe('10h 0min');
  });

  it('cost = the company cost per km × route km + the provider toll — complete (before: fuel from constants)', () => {
    const alt = build(trip);
    const kmPLN = 800 * 4.2;                              // 3360
    const tollEUR = 25.5 + 104;                           // 129.5 (from the provider amounts)
    expect(alt.costs.perKm).toEqual({ rate: 4.2, currency: 'PLN', amount: 3360, amountPLN: 3360, amountEUR: 772.8 });
    expect(alt.costs.tolls.totalEUR).toBeCloseTo(tollEUR, 2);
    expect(alt.costs.totalCostPLN).toBeCloseTo(kmPLN + tollEUR / 0.23, 1);
    expect(alt.costs.complete).toBe(true);
    expect(alt.costs).not.toHaveProperty('fuel');
  });

  it('without a toll provider: cost = rate × km without tolls, marked incomplete, with the codes', () => {
    const alt = build(trip, { quote: null, rate: 2000 });
    expect([alt.costs.tolls.totalEUR, alt.costs.tolls.totalPLN, alt.costs.tolls.source]).toEqual([null, null, null]);
    expect(alt.costs.totalCostPLN).toBe(3360);
    expect(alt.costs.complete).toBe(false);
    expect(alt.costs.messages.map((m: any) => m.code)).toEqual(expect.arrayContaining(['TOLL_PROVIDER_NOT_CONFIGURED', 'OFFER_COST_WITHOUT_TOLLS']));
    expect(alt.margin).toMatchObject({ complete: false });
  });

  it('a company without a cost per km: no cost and no margin, with the code — the toll stays', () => {
    const alt = build(trip, { company: { costPerKm: null, costCurrency: 'PLN' }, rate: 2000 });
    expect([alt.costs.perKm, alt.costs.totalCostPLN, alt.costs.totalCostEUR, alt.costs.costPerKmPLN]).toEqual([null, null, null, null]);
    expect(alt.costs.tolls.totalEUR).toBeCloseTo(129.5, 2);
    expect(alt.costs.messages.map((m: any) => m.code)).toContain('OFFER_COST_RATE_MISSING');
    expect(alt.margin).toMatchObject({ marginValue: null, marginPercent: null, messages: [{ code: 'OFFER_COST_RATE_MISSING' }] });
  });

  it('computes cost per km in both currencies', () => {
    const alt = build(trip);
    expect(alt.costs.costPerKmPLN).toBeCloseTo(alt.costs.totalCostPLN / 800, 2);
    expect(alt.costs.costPerKmEUR).toBeCloseTo(alt.costs.totalCostEUR / 800, 2);
    expect(alt.costs.eurPlnRate).toBe(4.3478); // 1 / 0.23 (common/fx)
  });

  it('country codes come from the route (km per country), not from the toll', () => {
    expect(build(trip, { quote: null }).countryCodes.sort()).toEqual(['DE', 'PL']);
  });

  it('adds a margin only when a freight rate is given', () => {
    expect(build(trip).margin).toBeUndefined();
    expect(build(trip, { rate: 2000, currency: 'EUR' }).margin).toMatchObject({
      freightRate: 2000,
      currency: 'EUR',
      complete: true,
    });
  });

  it('a freight rate of 0 or below adds no margin section', () => {
    expect(build(trip, { rate: 0 }).margin).toBeUndefined();
    expect(build(trip, { rate: -100 }).margin).toBeUndefined();
  });

  it('passes index, polyline and sections through unchanged', () => {
    const alt = build(trip, { index: 2 });
    expect(alt.index).toBe(2);
    expect(alt.polyline).toBe('poly-full');
    expect(alt.sections).toBe(trip.sections);
    expect(alt.label).toBe('');
  });

  it('a zero-length route does not divide by zero — no cost (no distance)', () => {
    const alt = build(route([]), { quote: null });
    expect(alt.distanceKm).toBe(0);
    expect([alt.costs.costPerKmPLN, alt.costs.costPerKmEUR, alt.costs.totalCostPLN]).toEqual([null, null, null]);
    expect(alt.costs.messages.map((m: any) => m.code)).toContain('OFFER_COST_NO_DISTANCE');
  });
});

describe('RoutePlannerService — assignLabels', () => {
  let service: RoutePlannerService;
  let cache: MemoryCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService();
    service = new RoutePlannerService(null as any, cache, null as any);
  });
  afterEach(() => cache.onModuleDestroy());

  const alt = (distanceKm: number, durationMin: number) =>
    ({ distanceKm, durationMin, label: '' } as any);

  const label = (list: any[]) => {
    (service as any).assignLabels(list);
    return list.map((a) => a.label);
  };

  it('without a company cost per km there is no "Najtańsza" — the list by km: shortest, fastest', () => {
    const mk = (km: number, min: number) => ({ distanceKm: km, durationMin: min, label: '' }) as any;
    const alts = [mk(800, 700), mk(900, 500), mk(950, 800)];
    (service as any).assignLabels(alts, false);
    expect(alts.map((a: any) => a.label)).toEqual(['Najkrótsza', 'Najszybsza', 'Trasa alternatywna 3']);
    const one = [mk(800, 500), mk(900, 700)];
    (service as any).assignLabels(one, false);
    expect(one.map((a: any) => a.label)).toEqual(['Najkrótsza / Najszybsza', 'Trasa alternatywna 2']);
  });

  it('an empty list does not throw', () => {
    expect(() => (service as any).assignLabels([])).not.toThrow();
  });

  it('the first route (the cheapest) gets the label "Najtańsza"', () => {
    // idx0 is only the cheapest; idx1 is faster and shorter
    expect(label([alt(900, 700), alt(800, 600)])[0]).toBe('Najtańsza');
  });

  it('gives separate labels when cheapest, fastest and shortest are different routes', () => {
    // idx0 cheapest (by definition), idx1 fastest, idx2 shortest
    expect(label([alt(900, 700), alt(950, 500), alt(800, 800)]))
      .toEqual(['Najtańsza', 'Najszybsza', 'Najkrótsza']);
  });

  it('combines the labels when one route is best at everything', () => {
    expect(label([alt(700, 500), alt(900, 700)])[0])
      .toBe('Najtańsza / Najszybsza / Najkrótsza');
  });

  it('combines "Najtańsza / Najszybsza"', () => {
    expect(label([alt(900, 500), alt(800, 700)])[0]).toBe('Najtańsza / Najszybsza');
  });

  it('combines "Najtańsza / Najkrótsza"', () => {
    expect(label([alt(800, 700), alt(900, 500)])[0]).toBe('Najtańsza / Najkrótsza');
  });

  it('the remaining routes get numbered labels', () => {
    const res = label([alt(700, 500), alt(900, 700), alt(950, 800)]);
    expect(res[2]).toBe('Trasa alternatywna 3');
  });

  it('a route both fastest and shortest gets only "Najszybsza" (the combined-label branch is unreachable)', () => {
    // idx1 is both the fastest and the shortest. The code has a separate branch
    // for this case, but the condition `!assigned.has(fastestIdx)` is already false,
    // because the index was added to `assigned` a few lines earlier.
    const res = label([alt(900, 700), alt(800, 500)]);
    expect(res[1]).toBe('Najszybsza');       // instead of 'Najszybsza / Najkrótsza'
  });

  it('findMinIndex returns the first index on a tie', () => {
    expect((service as any).findMinIndex([{ v: 5 }, { v: 5 }, { v: 9 }], (x: any) => x.v)).toBe(0);
  });
});

describe('RoutePlannerService — buildRecommendation', () => {
  let service: RoutePlannerService;
  let cache: MemoryCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService();
    service = new RoutePlannerService(null as any, cache, null as any);
  });
  afterEach(() => cache.onModuleDestroy());

  const makeAlt = (over: any = {}) => ({
    distanceKm: 800,
    durationFormatted: '10h 0min',
    costs: {
      totalCostPLN: 2000,
      totalCostEUR: 465,
      tolls: { breakdown: [{ country: 'Polska', costEUR: 20.1 }] },
    },
    ...over,
  });

  const reco = (alts: any[], currency = 'EUR') =>
    (service as any).buildRecommendation(alts, currency);

  it('an empty list gives a placeholder message', () => {
    expect(reco([])).toEqual({ recommendedIndex: 0, reason: 'Brak dostępnych tras.' });
  });

  it('always recommends index 0 (the list is already sorted by cost)', () => {
    expect(reco([makeAlt(), makeAlt()]).recommendedIndex).toBe(0);
  });

  it('uses the cost in EUR for EUR and the cost in PLN for any other currency', () => {
    expect(reco([makeAlt()], 'EUR').reason).toContain('465 EUR');
    expect(reco([makeAlt()], 'PLN').reason).toContain('2000 PLN');
  });

  it('states the saving against the second route', () => {
    const pricier = makeAlt({ costs: { ...makeAlt().costs, totalCostEUR: 500 } });
    expect(reco([makeAlt(), pricier]).reason).toContain('Oszczędność vs. następna trasa: 35 EUR');
  });

  it('leaves out the saving when the second route is not more expensive', () => {
    const cheaper = makeAlt({ costs: { ...makeAlt().costs, totalCostEUR: 400 } });
    expect(reco([makeAlt(), cheaper]).reason).not.toContain('Oszczędność');
  });

  it('lists the toll countries with their cost', () => {
    expect(reco([makeAlt()]).reason).toContain('Myto: Polska (20.1 EUR).');
  });

  it('adds the margin when it was computed', () => {
    const withMargin = makeAlt({ margin: { marginPercent: 22.5, marginValue: 135, currency: 'EUR' } });
    expect(reco([withMargin]).reason).toContain('marża 22.5% (135 EUR)');
  });

  // The margin is stated in the freight currency, not in the cost currency.
  it('states the margin in the freight currency', () => {
    const withMargin = makeAlt({ margin: { marginPercent: 10, marginValue: 200, currency: 'GBP' } });
    expect(reco([withMargin], 'GBP').reason).toContain('(200 GBP)');
  });

  it('leaves out a margin that has no exchange rate', () => {
    const withoutRate = makeAlt({ margin: { marginPercent: null, marginValue: null, currency: 'USD' } });
    expect(reco([withoutRate], 'USD').reason).not.toContain('marża');
  });
});

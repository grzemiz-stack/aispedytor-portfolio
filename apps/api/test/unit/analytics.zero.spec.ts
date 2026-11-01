/**
 * AnalyticsService — 0 is a result of an aggregation, not missing data
 * (ZN-01..ZN-06: six fields in two reports). Only an empty set gives `null`.
 *
 * The Prisma fake does not return ready numbers — it computes them from a set
 * of offers, as the database would. So the test checks the effect on a real
 * aggregation, not just on one expression.
 */
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { offerDbFake } from './helpers/offer-db-fake';

type OfferInput = {
  companyId?: string;
  pickupCountry?: string;
  deliveryCountry?: string;
  pricePerKm?: number | null;
  price?: number | null;
  profitMarginPercent?: number | null;
  /** A full margin (false) — the average counts only those. */
  marginWithoutTolls?: boolean | null;
  status?: string;
  createdAt?: Date;
};

const BASE_OFFER: OfferInput = {
  companyId: 'comp-1',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pricePerKm: 1.5,
  price: 1200,
  profitMarginPercent: 10,
  marginWithoutTolls: false,
  status: 'NEW',
  createdAt: new Date('2026-09-01'),
};

const makeOffer = (over: OfferInput = {}): OfferInput => ({ ...BASE_OFFER, ...over });

/**
 * Prisma fake that computes the results like the database, not a constant
 * (helpers/offer-db-fake.ts). Company and offers are in PLN: amounts pass through
 * fx unchanged (common/money.ts), so the numbers are the plain arithmetic ones.
 */
function makeService(testOffers: OfferInput[]) {
  const offerRows = testOffers.map((o, i) => ({ id: `o-${i}`, currency: 'PLN', pickupPostal: null, deliveryPostal: null, ...o }));
  const cache: any = { get: jest.fn().mockReturnValue(undefined), set: jest.fn() };
  return new AnalyticsService(offerDbFake(offerRows, [{ id: 'comp-1', costCurrency: 'PLN' }]), cache);
}

const routeStats = (s: AnalyticsService) => s.getRouteStats('comp-1', 'PL', 'DE');

// ── ZN-06: average margin ─────────────────────────────────────────────────────

describe('ZN-06 — average margin', () => {
  it('an offer with a 0% margin counts in the average and in the count', async () => {
    // Set: 0% and 10%. If the 0% offer dropped out of the count, the average
    // would be 10%. It counts — so 5%.
    const s = makeService([
      makeOffer({ profitMarginPercent: 0 }),
      makeOffer({ profitMarginPercent: 10 }),
    ]);

    const r: any = await s.getMarketOverview('comp-1');

    expect(r.avgMargin).toBe(5);
  });

  it('only 0% margins give an average of 0, not "no data"', async () => {
    const s = makeService([
      makeOffer({ profitMarginPercent: 0 }),
      makeOffer({ profitMarginPercent: 0 }),
      makeOffer({ profitMarginPercent: 0 }),
    ]);

    const r: any = await s.getMarketOverview('comp-1');

    expect(r.avgMargin).toBe(0);
  });

  it('a profit and a loss that cancel out give 0, not "no data"', async () => {
    const s = makeService([
      makeOffer({ profitMarginPercent: 8 }),
      makeOffer({ profitMarginPercent: -8 }),
    ]);

    const r: any = await s.getMarketOverview('comp-1');

    expect(r.avgMargin).toBe(0);
  });

  it('no offers with a computed margin still gives null', async () => {
    const s = makeService([makeOffer({ profitMarginPercent: null })]);

    const r: any = await s.getMarketOverview('comp-1');

    expect(r.avgMargin).toBeNull();
  });
});

// ── ZN-05: average price per km of a route in the market overview (same report as ZN-06) ───

describe('ZN-05 — average price per km of a route in the market overview', () => {
  it('a route whose rates are all 0 gives an average of 0, not "no data"', async () => {
    const s = makeService([
      makeOffer({ pricePerKm: 0 }),
      makeOffer({ pricePerKm: 0 }),
    ]);

    const r: any = await s.getMarketOverview('comp-1');

    expect(r.topRoutes[0].avgPricePerKm).toBe(0);
    expect(r.topRoutes[0].offerCount).toBe(2);
  });
});

// ── ZN-01..ZN-04: statystyki trasy ───────────────────────────────────────────

describe('ZN-02 — minimum rate', () => {
  it('a rate of 0 per km in the set is the minimum, not missing data', async () => {
    // The most likely of the six cases: a single offer with a rate of 0 must
    // not make the minimum of the whole report disappear.
    const s = makeService([
      makeOffer({ pricePerKm: 0 }),
      makeOffer({ pricePerKm: 1.5 }),
      makeOffer({ pricePerKm: 2.0 }),
    ]);

    const r: any = await routeStats(s);

    expect(r.minPricePerKm).toBe(0);
    expect(r.maxPricePerKm).toBe(2);
    expect(r.totalOffers).toBe(3);
  });
});

describe('ZN-01 — average rate of a route', () => {
  it('only rates of 0 give an average of 0, not "no data"', async () => {
    const s = makeService([makeOffer({ pricePerKm: 0 }), makeOffer({ pricePerKm: 0 })]);

    const r: any = await routeStats(s);

    expect(r.avgPricePerKm).toBe(0);
  });

  it('a rate of 0 counts in the average together with a non-zero one', async () => {
    const s = makeService([makeOffer({ pricePerKm: 0 }), makeOffer({ pricePerKm: 3 })]);

    const r: any = await routeStats(s);

    expect(r.avgPricePerKm).toBe(1.5);
  });
});

describe('ZN-03 — maximum rate', () => {
  it('when all rates are 0, the maximum is 0 too', async () => {
    const s = makeService([makeOffer({ pricePerKm: 0 }), makeOffer({ pricePerKm: 0 })]);

    const r: any = await routeStats(s);

    expect(r.maxPricePerKm).toBe(0);
  });
});

describe('ZN-04 — average price of a route', () => {
  it('offers priced 0 give an average price of 0, not "no data"', async () => {
    const s = makeService([
      makeOffer({ price: 0 }),
      makeOffer({ price: 0 }),
    ]);

    const r: any = await routeStats(s);

    expect(r.avgPrice).toBe(0);
  });

  it('a price of 0 counts in the average together with a non-zero one', async () => {
    const s = makeService([makeOffer({ price: 0 }), makeOffer({ price: 1000 })]);

    const r: any = await routeStats(s);

    expect(r.avgPrice).toBe(500);
  });
});

// ── Control: no data still gives null ────────────────────────────────────────

describe('no data still gives null', () => {
  it('an empty set of offers gives null in all four amount fields of the route report', async () => {
    const s = makeService([]);

    const r: any = await routeStats(s);

    expect(r.avgPricePerKm).toBeNull();
    expect(r.minPricePerKm).toBeNull();
    expect(r.maxPricePerKm).toBeNull();
    expect(r.avgPrice).toBeNull();
    expect(r.totalOffers).toBe(0);
  });

  it('non-zero values pass through unchanged', async () => {
    const s = makeService([makeOffer({ pricePerKm: 1.5, price: 1200 })]);

    const r: any = await routeStats(s);

    expect(r.avgPricePerKm).toBe(1.5);
    expect(r.minPricePerKm).toBe(1.5);
    expect(r.maxPricePerKm).toBe(1.5);
    expect(r.avgPrice).toBe(1200);
  });
});

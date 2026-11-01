/**
 * Dashboard and analytics amounts in the company currency.
 *
 * Every amount goes through common/fx.ts to `Company.costCurrency`
 * (common/money.ts). An offer in a currency missing from the rate table is not
 * added — it is counted in `money.unconverted` with the code
 * TOTAL_EXCLUDES_UNCONVERTED.
 *
 * The company counts in PLN. Offers (fx rates: EUR = 1/0.23 PLN, GBP = 5 PLN,
 * USD — not in the table):
 *   A  accepted  1000 EUR  2.0 /km   (= 4347.83 PLN, 8.70 PLN/km)
 *   B  accepted  4000 PLN  8.0 /km
 *   C  accepted   500 GBP  1.0 /km   (= 2500.00 PLN, 5.00 PLN/km)
 *   D  new       2000 EUR  2.5 /km   (not revenue; 8695.65 PLN, 10.87 PLN/km)
 *   E  accepted   300 USD  1.5 /km   (not convertible, DE→PL)
 *
 * Numbers when the currencies are added as they are, and in PLN:
 *
 *   value                           | mixed            | in PLN
 *   stats: revenue                  |  5800            | 10847.83  (A+B+C; E left out)
 *   stats: average /km              |  3.0             |  8.1413   (A,B,C,D; E left out)
 *   overview: revenue               |  5800            | 10847.83
 *   overview: average /km PL→DE     |  3.375           |  8.1413
 *   overview: last / this month     |  500 / 5300      |  2500 / 8347.83
 *   route-stats PL→DE: avg /km      |  3.375           |  8.1413
 *   route-stats PL→DE: min / max    |  1 / 8           |  5 / 10.87
 *   route-stats PL→DE: avg price    |  1875            |  4885.87
 */
import { OffersService } from '../../src/offers/offers.service';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { offerDbFake } from './helpers/offer-db-fake';

const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 2, 12);

const base = { companyId: 'comp-1', pickupCountry: 'PL', deliveryCountry: 'DE', pickupPostal: null, deliveryPostal: null, profitMarginPercent: null, source: 'MANUAL' };
export const DASHBOARD_OFFERS = [
  { ...base, id: 'A', status: 'ACCEPTED', price: 1000, currency: 'EUR', pricePerKm: 2.0, createdAt: thisMonth },
  { ...base, id: 'B', status: 'ACCEPTED', price: 4000, currency: 'PLN', pricePerKm: 8.0, createdAt: thisMonth },
  { ...base, id: 'C', status: 'ACCEPTED', price: 500, currency: 'GBP', pricePerKm: 1.0, createdAt: lastMonth },
  { ...base, id: 'D', status: 'NEW', price: 2000, currency: 'EUR', pricePerKm: 2.5, createdAt: thisMonth },
  { ...base, id: 'E', status: 'ACCEPTED', price: 300, currency: 'USD', pricePerKm: 1.5, createdAt: thisMonth, pickupCountry: 'DE', deliveryCountry: 'PL' },
];
export const DASHBOARD_COMPANY = [{ id: 'comp-1', costCurrency: 'PLN' }];

const cache: any = { get: () => undefined, set: () => undefined };
const offers = () => new OffersService(offerDbFake(DASHBOARD_OFFERS, DASHBOARD_COMPANY), {} as any, cache, {} as any);
const analytics = () => new AnalyticsService(offerDbFake(DASHBOARD_OFFERS, DASHBOARD_COMPANY), cache);

const EUR = 1 / 0.23;
const company = (costCurrency: string) => [{ id: 'comp-1', costCurrency }];

describe('dashboard money — in the company currency through fx', () => {
  it('offers/stats: revenue A+B+C in PLN; the USD offer is counted as unconverted, not added', async () => {
    const s: any = await offers().getStats('comp-1');
    expect(s.totalRevenue).toBeCloseTo(1000 * EUR + 4000 + 500 * 5, 6);
    expect(s.avgPricePerKm).toBeCloseTo((2 * EUR + 8 + 1 * 5 + 2.5 * EUR) / 4, 10);
    expect(s.money.currency).toBe('PLN');
    expect(s.money.unconverted).toBe(1);
    // One code per rate used (currency pair), not per amount.
    expect(s.money.codes.map((c: any) => [c.code, c.params.from, c.params.to])).toEqual([
      ['FX_RATE_STATIC', 'EUR', 'PLN'],
      ['FX_RATE_STATIC', 'GBP', 'PLN'],
      ['TOTAL_EXCLUDES_UNCONVERTED', 'USD', 'PLN'],
    ]);
    expect(s.money.codes[2].params.count).toBe(1);
  });

  it('analytics/market-overview: revenue, per-route average and months in PLN', async () => {
    const o: any = await analytics().getMarketOverview('comp-1');
    expect(o.totalRevenue).toBeCloseTo(1000 * EUR + 4000 + 2500, 6);
    const plde = o.topRoutes.find((r: any) => r.pickupCountry === 'PL');
    expect(plde.avgPricePerKm).toBeCloseTo((2 * EUR + 8 + 5 + 2.5 * EUR) / 4, 10);
    const depl = o.topRoutes.find((r: any) => r.pickupCountry === 'DE');
    expect(depl.avgPricePerKm).toBeNull();
    const months = o.monthlyRevenue.map((m: any) => m.revenue);
    expect(months[months.length - 2]).toBeCloseTo(2500, 6);
    expect(months[months.length - 1]).toBeCloseTo(1000 * EUR + 4000, 6);
    expect(o.money).toMatchObject({ currency: 'PLN', unconverted: 1 });
  });

  it('analytics/route-stats PL→DE: avg/min/max per km and avg price in PLN', async () => {
    const r: any = await analytics().getRouteStats('comp-1', 'PL', 'DE');
    expect(r.avgPricePerKm).toBeCloseTo((2 * EUR + 8 + 5 + 2.5 * EUR) / 4, 10);
    expect(r.minPricePerKm).toBeCloseTo(5, 10);
    expect(r.maxPricePerKm).toBeCloseTo(2.5 * EUR, 10);
    expect(r.avgPrice).toBeCloseTo((1000 * EUR + 4000 + 2500 + 2000 * EUR) / 4, 6);
    expect(r.money).toMatchObject({ currency: 'PLN', unconverted: 0 });
  });

  it('analytics/route-stats DE→PL: only a USD offer — no average, one unconverted, with the code', async () => {
    const r: any = await analytics().getRouteStats('comp-1', 'DE', 'PL');
    expect([r.avgPricePerKm, r.minPricePerKm, r.maxPricePerKm, r.avgPrice]).toEqual([null, null, null, null]);
    expect(r.totalOffers).toBe(1);
    expect(r.money.unconverted).toBe(1);
    expect(r.money.codes).toEqual([
      { code: 'TOTAL_EXCLUDES_UNCONVERTED', params: { count: 1, from: 'USD', to: 'PLN' } },
    ]);
  });

  it('a company counting in EUR gets EUR: 1000 + 4000×0.23 + 500×1.15', async () => {
    const svc = new OffersService(offerDbFake(DASHBOARD_OFFERS, company('EUR')), {} as any, cache, {} as any);
    const s: any = await svc.getStats('comp-1');
    expect(s.totalRevenue).toBeCloseTo(1000 + 920 + 575, 6);
    expect(s.money.currency).toBe('EUR');
  });
});

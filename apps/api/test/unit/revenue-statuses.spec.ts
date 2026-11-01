/**
 * Revenue counts every job the company took on, not only those still in
 * ACCEPTED. The web flow moves a job ACCEPTED → IN_TRANSIT
 * → COMPLETED; before, it dropped out of revenue at the first move.
 */
import { OffersService } from '../../src/offers/offers.service';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import { REVENUE_STATUSES } from '../../src/common/money';
import { offerDbFake } from './helpers/offer-db-fake';

const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
const base = { companyId: 'comp-1', pickupCountry: 'PL', deliveryCountry: 'DE', pickupPostal: null, deliveryPostal: null, profitMarginPercent: null, source: 'MANUAL', currency: 'PLN', pricePerKm: null, createdAt: thisMonth };
const OFFERS = [
  { ...base, id: 'acc', status: 'ACCEPTED', price: 1000 },
  { ...base, id: 'transit', status: 'IN_TRANSIT', price: 2000 },
  { ...base, id: 'done', status: 'COMPLETED', price: 4000 },
  { ...base, id: 'new', status: 'NEW', price: 8000 },
  { ...base, id: 'assigned', status: 'ASSIGNED', price: 16000 },
  { ...base, id: 'rejected', status: 'REJECTED', price: 32000 },
  { ...base, id: 'expired', status: 'EXPIRED', price: 64000 },
];
const COMPANY = [{ id: 'comp-1', costCurrency: 'PLN' }];
const cache: any = { get: () => undefined, set: () => undefined };

it('the revenue statuses are the taken-on jobs', () => {
  expect([...REVENUE_STATUSES]).toEqual(['ACCEPTED', 'IN_TRANSIT', 'COMPLETED']);
});

it('offers/stats: revenue = accepted + in transit + completed; the count says the same', async () => {
  const s: any = await new OffersService(offerDbFake(OFFERS, COMPANY), {} as any, cache, {} as any).getStats('comp-1');
  expect([s.totalRevenue, s.acceptedCount]).toEqual([7000, 3]);
});

it('analytics/market-overview: total and this month\'s revenue include in-transit and completed jobs', async () => {
  const o: any = await new AnalyticsService(offerDbFake(OFFERS, COMPANY), cache).getMarketOverview('comp-1');
  const month = o.monthlyRevenue.find((m: any) => m.revenue > 0);
  expect([o.totalRevenue, month?.revenue]).toEqual([7000, 7000]);
});

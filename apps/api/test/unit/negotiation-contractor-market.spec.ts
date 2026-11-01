/**
 * The contractor profile in negotiation: the number of orders from the offers,
 * and "contractor vs market" on the rate per km on similar routes.
 *
 * Before: `totalOrders` was read from a column nothing wrote (always 0, or a
 * number from the seed); "contractor vs market %" compared average AMOUNTS
 * from unrelated routes (the contractor's Poznań–Berlin with the market's
 * Lisbon), without km. Now:
 *  - `totalOrders` = the contractor's offers in the revenue statuses
 *    (REVENUE_STATUSES), counted on read — there is no column;
 *  - the average rate per km on similar routes: the same pickup and delivery
 *    countries, the distance within 100 km of the offer's; the contractor —
 *    their offers (without the current one), the market — the company's other
 *    offers in the system (mostly imported from exchanges, not outside market
 *    data) from 90 days, without this contractor's offers;
 *  - below 3 contractor offers or 5 market offers there is no comparison:
 *    `priceVsMarket: null` + NEGOTIATION_SAMPLE_TOO_SMALL.
 */
import { NegotiationService } from '../../src/negotiation/negotiation.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const DAY = 86_400_000;
const OFFER = { id: 'o1', pickupCountry: 'PL', deliveryCountry: 'DE', distanceKm: 800, currency: 'PLN', price: 4000 };
type Row = { id: string; contractorId: string | null; pickupCountry: string; deliveryCountry: string; distanceKm: number | null; price: number; currency: string; createdAt: Date; status: string };
let seq = 0;
const row = (over: Partial<Row>): Row => ({
  id: `r${++seq}`, contractorId: null, pickupCountry: 'PL', deliveryCountry: 'DE', distanceKm: 800, price: 3200, currency: 'PLN',
  createdAt: new Date(Date.now() - 5 * DAY), status: 'NEW', ...over,
});
const K = (n: number, over: Partial<Row> = {}) => Array.from({ length: n }, () => row({ contractorId: 'k', ...over }));
const M = (n: number, over: Partial<Row> = {}) => Array.from({ length: n }, () => row({ contractorId: 'other', ...over }));

/** A fake of `where` in the scope getContractorAnalysis uses. */
function matches(r: Row, w: any): boolean {
  if (w.contractorId !== undefined && typeof w.contractorId === 'string' && r.contractorId !== w.contractorId) return false;
  if (w.pickupCountry && r.pickupCountry !== w.pickupCountry) return false;
  if (w.deliveryCountry && r.deliveryCountry !== w.deliveryCountry) return false;
  if (w.id?.not && r.id === w.id.not) return false;
  if (w.createdAt?.gte && r.createdAt < w.createdAt.gte) return false;
  if (w.status?.in && !w.status.in.includes(r.status)) return false;
  if (w.distanceKm?.not === null && r.distanceKm == null) return false;
  if (w.OR && !w.OR.some((o: any) => (o.contractorId === null ? r.contractorId === null : r.contractorId !== o.contractorId?.not))) return false;
  return true;
}

function analysis(rows: Row[]) {
  const prisma: any = {
    contractor: { findFirst: async () => ({ id: 'k', name: 'K', paymentRating: 4, reliabilityScore: 80, avgPaymentDays: 30 }) },
    offer: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
      count: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).length),
    },
  };
  const svc = new NegotiationService(prisma);
  return { run: () => (svc as any).getContractorAnalysis('k', 'c', OFFER, 800), prisma };
}

describe('totalOrders from the offers', () => {
  it('counts only the contractor offers in the revenue statuses (accepted, in transit, completed)', async () => {
    const { run } = analysis([
      ...K(1, { status: 'ACCEPTED' }), ...K(1, { status: 'IN_TRANSIT' }), ...K(2, { status: 'COMPLETED' }),
      ...K(3, { status: 'NEW' }), ...K(1, { status: 'REJECTED' }), ...M(4, { status: 'COMPLETED' }),
    ]);
    expect((await run()).totalOrders).toBe(4);
  });
});

describe('contractor vs market: rate per km on similar routes', () => {
  it('3 contractor offers at 5.00 PLN/km, 5 market offers at 4.00 PLN/km → +25 %, above', async () => {
    const { run } = analysis([
      ...K(3, { distanceKm: 800, price: 4000 }),
      ...M(5, { distanceKm: 800, price: 3200 }),
    ]);
    const p = await run();
    expect([p.priceVsMarket, p.priceVsMarketPct, p.messages.map((m: any) => m.code)]).toEqual(['above', 25, []]);
  });

  it('rate per km, not the amount: a longer similar route at the same rate is the same price level', async () => {
    // The contractor 850 km × 4 PLN = 3400, the market 750 km × 4 PLN = 3000 — different amounts, the same rate.
    const { run } = analysis([...K(3, { distanceKm: 850, price: 3400 }), ...M(5, { distanceKm: 750, price: 3000 })]);
    expect([(await run()).priceVsMarket, (await run()).priceVsMarketPct]).toEqual(['market', 0]);
  });

  it('only similar routes count: other countries and distances beyond 100 km are left out', async () => {
    const { run } = analysis([
      ...K(3, { price: 4000 }),
      ...K(5, { deliveryCountry: 'FR', price: 99_000 }), ...K(5, { distanceKm: 901, price: 99_000 }),
      ...M(5, { price: 3200 }),
      ...M(5, { pickupCountry: 'DE', price: 1 }), ...M(5, { distanceKm: 699, price: 1 }), ...M(5, { distanceKm: null, price: 1 }),
    ]);
    expect((await run()).priceVsMarketPct).toBe(25);
  });

  it('exactly 100 km away still counts as a similar route (900 and 700 km for an 800 km offer)', async () => {
    // The contractor 900 km × 5 PLN = 4500, the market 700 km × 4 PLN = 2800 → +25 %.
    const { run } = analysis([...K(3, { distanceKm: 900, price: 4500 }), ...M(5, { distanceKm: 700, price: 2800 })]);
    expect((await run()).priceVsMarketPct).toBe(25);
  });

  it('the market leaves out the contractor\'s own offers, the current offer and offers older than 90 days', async () => {
    const { run } = analysis([
      ...K(3, { price: 4000 }),
      ...M(5, { price: 3200 }),
      row({ id: 'o1', contractorId: 'other', price: 1 }),
      ...M(5, { price: 1, createdAt: new Date(Date.now() - 91 * DAY) }),
    ]);
    expect((await run()).priceVsMarketPct).toBe(25);
  });

  it.each([
    ['2 contractor offers', 2, 5],
    ['4 market offers', 3, 4],
  ])('%s → no comparison, NEGOTIATION_SAMPLE_TOO_SMALL with the counts', async (_n, k, m) => {
    const { run } = analysis([...K(k, { price: 4000 }), ...M(m, { price: 3200 })]);
    const p = await run();
    expect([p.priceVsMarket, p.priceVsMarketPct]).toEqual([null, null]);
    expect(p.messages).toEqual([{ code: 'NEGOTIATION_SAMPLE_TOO_SMALL', params: { contractorOffers: k, marketOffers: m, minContractorOffers: 3, minMarketOffers: 5 } }]);
  });

  it('an offer without a distance → no similar routes → no comparison', async () => {
    const prisma: any = {
      contractor: { findFirst: async () => ({ id: 'k', name: 'K', paymentRating: 4, reliabilityScore: 80, avgPaymentDays: 30 }) },
      offer: { findMany: jest.fn(async () => [...K(3), ...M(5)]), count: jest.fn(async () => 0) },
    };
    const p = await (new NegotiationService(prisma) as any).getContractorAnalysis('k', 'c', { ...OFFER, distanceKm: null }, null);
    expect([p.priceVsMarket, p.messages[0].code]).toEqual([null, 'NEGOTIATION_SAMPLE_TOO_SMALL']);
  });
});

it('NEGOTIATION_SAMPLE_TOO_SMALL is in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toContain('NEGOTIATION_SAMPLE_TOO_SMALL');
});

describe('orders in the last 30 / 90 days and "regular partner" — the same revenue statuses as the total (audit 3, W10)', () => {
  // Before: 30/90 days counted offers in any status — "Stały partner (0 zleceń łącznie, 7 w ostatnim miesiącu)".
  it('7 NEW offers this month, none taken → 0 orders in 30 and 90 days, not a regular partner', async () => {
    const r: any = await analysis(K(7, { status: 'NEW' })).run();
    expect([r.totalOrders, r.recentOrders30d, r.recentOrders90d, r.isRegular]).toEqual([0, 0, 0, false]);
  });

  it('5 taken this month (accepted, in transit, completed) + 3 rejected → 5 / 5, regular; 2 older taken count in 90 days only', async () => {
    const rows = [
      ...K(2, { status: 'ACCEPTED' }), ...K(2, { status: 'IN_TRANSIT' }), ...K(1, { status: 'COMPLETED' }), ...K(3, { status: 'REJECTED' }),
      ...K(2, { status: 'COMPLETED', createdAt: new Date(Date.now() - 60 * DAY) }),
    ];
    const r: any = await analysis(rows).run();
    expect([r.totalOrders, r.recentOrders30d, r.recentOrders90d, r.isRegular]).toEqual([7, 5, 7, true]);
  });

  it('4 taken this month + 2 older → not yet regular (5 orders within 30 days, not 90)', async () => {
    const older = K(2, { status: 'COMPLETED', createdAt: new Date(Date.now() - 60 * DAY) });
    const r: any = await analysis([...K(4, { status: 'ACCEPTED' }), ...K(6, { status: 'NEW' }), ...older]).run();
    expect([r.recentOrders30d, r.recentOrders90d, r.isRegular]).toEqual([4, 6, false]);
  });
});

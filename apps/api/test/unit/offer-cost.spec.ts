/**
 * offerCost — one basis for the offer cost.
 *
 * Before: three formulas for the same offer — the negotiation argument (fuel
 * from constants 32 l/100 km × 6.50 PLN + toll), the simulation (the same +
 * "other" 0.5 PLN/km) and the planner (fuel + toll); the company `costPerKm`
 * was read only by LTL. Now: cost = the company `costPerKm` × km + toll, the
 * rate without tolls, in the company currency. Sources in order:
 *  1. a planner route — km and toll from the route (toll `null` = not quoted:
 *     no toll provider → a cost without tolls);
 *  2. no route — offer km, an estimate (OFFER_COST_ESTIMATED); the manual toll
 *     from the offer if any, else a cost without tolls (OFFER_COST_WITHOUT_TOLLS);
 *  3. no distance — no cost (OFFER_COST_NO_DISTANCE).
 * Without the company `costPerKm` — no cost (OFFER_COST_RATE_MISSING), no
 * constants. The manual toll from the offer goes before the route toll.
 */
import { offerCost, costIn } from '../../src/common/offer-cost';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const PLN_RATE = { costPerKm: 4.2, costCurrency: 'PLN' };
const ROUTE = { distanceKm: 300, tollEUR: 80 };
const codes = (r: { messages: { code: string }[] }) => r.messages.map((m) => m.code);
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

it('a route from the planner: company rate × route km + route toll', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: 250, manualToll: null, company: PLN_RATE });
  if (!r.ok) throw new Error('expected a cost');
  expect([r.source, r.distanceKm, r.perKm.amount, r.perKm.currency, r.toll, r.withoutTolls, codes(r)]).toEqual([
    'route', 300, 1260, 'PLN', { amountEUR: 80, from: 'route' }, false, [],
  ]);
  // 1260 PLN × 0,23 = 289,80 EUR + 80 EUR myta
  expect([round2(r.totalEUR), round2(costIn(r, 'PLN'))]).toEqual([369.8, 1607.83]);
});

it('a manual toll from the offer goes before the route toll', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: null, manualToll: { amount: 100, currency: 'EUR' }, company: PLN_RATE });
  expect(r.ok && [r.source, r.toll, round2(r.totalEUR)]).toEqual(['route', { amountEUR: 100, from: 'manual' }, 389.8]);
});

it('no route: an estimate from the offer distance; no toll at all → cost without tolls, both codes', () => {
  const r = offerCost({ route: null, offerDistanceKm: 300, manualToll: null, company: PLN_RATE });
  expect(r.ok && [r.source, r.toll, r.withoutTolls, codes(r), round2(costIn(r, 'PLN'))]).toEqual([
    'company_rate', null, true, ['OFFER_COST_ESTIMATED', 'OFFER_COST_WITHOUT_TOLLS'], 1260,
  ]);
});

it('no route but a manual toll: an estimate with that toll, not "without tolls"', () => {
  const r = offerCost({ route: null, offerDistanceKm: 300, manualToll: { amount: 344, currency: 'PLN' }, company: PLN_RATE });
  expect(r.ok && [r.withoutTolls, codes(r), round2(costIn(r, 'PLN'))]).toEqual([false, ['OFFER_COST_ESTIMATED'], 1604]);
});

it('a route without a toll quote (no toll provider): km from the route, the cost without tolls, not an estimate', () => {
  const r = offerCost({ route: { distanceKm: 300, tollEUR: null }, offerDistanceKm: 250, manualToll: null, company: PLN_RATE });
  expect(r.ok && [r.source, r.distanceKm, r.toll, r.withoutTolls, codes(r), round2(costIn(r, 'PLN'))]).toEqual([
    'route', 300, null, true, ['OFFER_COST_WITHOUT_TOLLS'], 1260,
  ]);
});

it('a route without a toll quote but a manual toll: the manual toll counts', () => {
  const r = offerCost({ route: { distanceKm: 300, tollEUR: null }, offerDistanceKm: null, manualToll: { amount: 100, currency: 'EUR' }, company: PLN_RATE });
  expect(r.ok && [r.toll, r.withoutTolls, codes(r)]).toEqual([{ amountEUR: 100, from: 'manual' }, false, []]);
});

it('a route of 0 km is not a route (falls back to the offer distance)', () => {
  const r = offerCost({ route: { distanceKm: 0, tollEUR: 0 }, offerDistanceKm: 300, manualToll: null, company: PLN_RATE });
  expect(r.ok && [r.source, r.distanceKm]).toEqual(['company_rate', 300]);
});

it.each([
  ['no route, no offer distance', { route: null, offerDistanceKm: null }],
  ['no route, offer distance 0', { route: null, offerDistanceKm: 0 }],
])('%s → no cost, OFFER_COST_NO_DISTANCE', (_n, over) => {
  const r = offerCost({ manualToll: null, company: PLN_RATE, ...over } as any);
  expect([r.ok, codes(r)]).toEqual([false, ['OFFER_COST_NO_DISTANCE']]);
});

it('no company rate → no cost, OFFER_COST_RATE_MISSING — even with a route (no fuel constants)', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: 300, manualToll: null, company: { costPerKm: null, costCurrency: 'PLN' } });
  expect([r.ok, codes(r)]).toEqual([false, ['OFFER_COST_RATE_MISSING']]);
});

it('the rate is in the company currency (GBP)', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: null, manualToll: null, company: { costPerKm: 1.5, costCurrency: 'GBP' } });
  // 300 km × 1,50 GBP = 450 GBP × 1,15 = 517,50 EUR + 80 EUR
  expect(r.ok && [r.perKm.amount, r.perKm.currency, round2(r.totalEUR)]).toEqual([450, 'GBP', 597.5]);
});

it('a manual toll in a currency without a rate → no cost, the conversion code', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: null, manualToll: { amount: 100, currency: 'XYZ' }, company: PLN_RATE });
  expect([r.ok, codes(r)]).toEqual([false, ['CURRENCY_CONVERSION_UNAVAILABLE']]);
});

it('costIn: a currency without a rate gives null, not a number', () => {
  const r = offerCost({ route: ROUTE, offerDistanceKm: null, manualToll: null, company: PLN_RATE });
  expect(r.ok && costIn(r, 'XYZ')).toBeNull();
});

it('the four codes are in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toEqual(expect.arrayContaining(['OFFER_COST_ESTIMATED', 'OFFER_COST_WITHOUT_TOLLS', 'OFFER_COST_NO_DISTANCE', 'OFFER_COST_RATE_MISSING']));
});

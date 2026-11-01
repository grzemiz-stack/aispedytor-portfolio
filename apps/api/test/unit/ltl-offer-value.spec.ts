/**
 * offerValue — the value of a part-load offer, the LTL ranking key.
 *
 * Numbers are hard-coded and worked out by hand in the comments. Rates from
 * common/fx.ts: 1 EUR = 1 / 0.23 PLN, 1 GBP = 1.15 / 0.23 = 5 PLN.
 */
import { compareByValue, offerValue, type OfferValueInput, type RouteCalculationRow } from '../../src/ltl-matching/offer-value';

const EUR_PLN = 1 / 0.23;

const row = (over: Partial<RouteCalculationRow> = {}): RouteCalculationRow => ({
  distanceKm: 330,
  tollTotalEur: 95.7, // 0.29 EUR/km
  axleClass: '5+',
  axleClassDefaulted: false,
  tollNeedsVerification: false,
  calculatedAt: new Date('2026-09-30T10:00:00Z'),
  ...over,
});

const input = (over: Partial<OfferValueInput> = {}): OfferValueInput => ({
  price: 1200,
  priceCurrency: 'PLN',
  detourKm: 100,
  company: { costPerKm: 4.2, costCurrency: 'PLN' },
  vehicleAxleClass: '5+',
  routeCalculations: [],
  // Default: no toll provider registered (src/tolls).
  tollProviderConfigured: false,
  ...over,
});

const codes = (v: { codes: { code: string }[] }) => v.codes.map(c => c.code);

describe('offerValue — revenue (no cost per km)', () => {
  it('price in the company currency, basis REVENUE, no cost fields', () => {
    const v = offerValue(input({ company: { costPerKm: null, costCurrency: 'PLN' } }));
    expect(v).toMatchObject({ amount: 1200, currency: 'PLN', basis: 'REVENUE', detourCost: null, detourToll: null });
    expect(codes(v)).toEqual(['DETOUR_COST_UNKNOWN']);
  });

  it('1200 EUR for a PLN company = 1200 / 0.23 PLN, with FX_RATE_STATIC', () => {
    const v = offerValue(input({ priceCurrency: 'EUR', company: { costPerKm: null, costCurrency: 'PLN' } }));
    expect(v.amount).toBeCloseTo(1200 * EUR_PLN, 6);
    expect(v.codes).toContainEqual({ code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'PLN', rate: 4.3478 } });
  });

  it('no cap: revenue keeps growing with the price (old score capped at 15 points)', () => {
    const a = offerValue(input({ price: 5000, company: { costPerKm: null, costCurrency: 'PLN' } }));
    const b = offerValue(input({ price: 9000, company: { costPerKm: null, costCurrency: 'PLN' } }));
    expect(b.amount! - a.amount!).toBe(4000);
  });
});

describe('offerValue — profit', () => {
  it('no provider, no row: 1200 − 100 × 4.20 = 780, toll null with TOLL_PROVIDER_NOT_CONFIGURED', () => {
    const v = offerValue(input());
    expect(v).toMatchObject({ amount: 780, basis: 'PROFIT', detourCost: 420, detourToll: null });
    expect(v.codes).toEqual([{ code: 'TOLL_PROVIDER_NOT_CONFIGURED' }]);
  });

  it('provider registered, offer route not calculated: toll null with ROUTE_NOT_CALCULATED', () => {
    const v = offerValue(input({ tollProviderConfigured: true }));
    expect(v).toMatchObject({ amount: 780, detourToll: null });
    expect(v.codes).toEqual([{ code: 'DETOUR_TOLL_NOT_INCLUDED', params: { reason: 'ROUTE_NOT_CALCULATED' } }]);
  });

  it('no price: the threshold price excludes the toll that is not known', () => {
    const v = offerValue(input({ price: null }));
    expect(v.thresholdPrice).toBe(420);
  });

  it('toll from a matching row: 100 km × 0.29 EUR/km = 29 EUR = 126.09 PLN', () => {
    const v = offerValue(input({ routeCalculations: [row()] }));
    expect(v.detourToll).toBeCloseTo(29 * EUR_PLN, 6);
    expect(v.amount).toBeCloseTo(1200 - 420 - 29 * EUR_PLN, 6);
    expect(codes(v)).toEqual(['DETOUR_TOLL_ESTIMATED', 'FX_RATE_STATIC']);
    expect(v.codes[0].params).toEqual({ rateEurPerKm: 0.29, axleClass: '5+' });
  });

  it('EUR price and EUR toll: one rate, one FX_RATE_STATIC', () => {
    const v = offerValue(input({ priceCurrency: 'EUR', routeCalculations: [row()] }));
    expect(v.amount).toBeCloseTo(1200 * EUR_PLN - 420 - 29 * EUR_PLN, 6);
    expect(codes(v).filter(c => c === 'FX_RATE_STATIC')).toHaveLength(1);
  });

  it('EUR company: toll needs no conversion, cost per km is already in EUR', () => {
    const v = offerValue(input({ priceCurrency: 'EUR', company: { costPerKm: 1, costCurrency: 'EUR' }, routeCalculations: [row()] }));
    expect(v.amount).toBeCloseTo(1200 - 100 - 29, 6);
    expect(codes(v)).toEqual(['DETOUR_TOLL_ESTIMATED']);
  });

  it.each([
    ['another axle class', row({ axleClass: '4' })],
    ['class defaulted by the planner', row({ axleClassDefaulted: true })],
    ['row without a class', row({ axleClass: null })],
  ])('%s → the row is not used; no toll, with the reason', (_label, r) => {
    const v = offerValue(input({ routeCalculations: [r], tollProviderConfigured: true }));
    expect(v.detourToll).toBeNull();
    expect(codes(v)).toEqual(['DETOUR_TOLL_NOT_INCLUDED']);
  });

  it('vehicle axle class unknown → toll not included, even with a row', () => {
    const v = offerValue(input({ vehicleAxleClass: null, routeCalculations: [row()] }));
    expect(v.detourToll).toBeNull();
    expect(v.codes).toContainEqual({ code: 'DETOUR_TOLL_NOT_INCLUDED', params: { reason: 'VEHICLE_AXLE_CLASS_UNKNOWN' } });
  });

  it('the newest matching row wins', () => {
    const v = offerValue(input({
      routeCalculations: [
        row({ tollTotalEur: 33, calculatedAt: new Date('2026-09-01') }), // 0.10 EUR/km
        row({ tollTotalEur: 99, calculatedAt: new Date('2026-09-20') }), // 0.30 EUR/km
        row({ tollTotalEur: 66, calculatedAt: new Date('2026-09-10') }),
      ],
    }));
    expect(v.detourToll).toBeCloseTo(30 * EUR_PLN, 6);
  });

  it('detour 0 km → no cost, no toll, no toll code', () => {
    const v = offerValue(input({ detourKm: 0, routeCalculations: [row()] }));
    expect(v).toMatchObject({ amount: 1200, detourCost: 0, detourToll: 0, codes: [] });
  });

  it('loss → LOAD_DOES_NOT_COVER_DETOUR with the loss', () => {
    const v = offerValue(input({ price: 300 }));
    expect(v.amount).toBe(-120);
    expect(v.codes).toContainEqual({ code: 'LOAD_DOES_NOT_COVER_DETOUR', params: { loss: 120, currency: 'PLN' } });
  });

  it('price 0 given explicitly is a price: profit = 0 − cost', () => {
    const v = offerValue(input({ price: 0 }));
    expect(v.amount).toBe(-420);
    expect(codes(v)).not.toContain('OFFER_PRICE_MISSING');
  });
});

describe('offerValue — no amount (goes to the end of the list)', () => {
  it('no price, cost known → threshold price = cost + toll, with code', () => {
    const v = offerValue(input({ price: null, routeCalculations: [row()] }));
    expect(v.amount).toBeNull();
    expect(v.thresholdPrice).toBeCloseTo(420 + 29 * EUR_PLN, 6);
    expect(codes(v)).toEqual(expect.arrayContaining(['OFFER_PRICE_MISSING', 'OFFER_THRESHOLD_PRICE']));
    expect(v.codes.find(c => c.code === 'OFFER_THRESHOLD_PRICE')!.params).toEqual({ amount: 546.09, currency: 'PLN' });
  });

  it('no price, no cost → only OFFER_PRICE_MISSING (and DETOUR_COST_UNKNOWN), no threshold', () => {
    const v = offerValue(input({ price: null, company: { costPerKm: null, costCurrency: 'PLN' } }));
    expect(v.thresholdPrice).toBeNull();
    expect(codes(v)).toEqual(['DETOUR_COST_UNKNOWN', 'OFFER_PRICE_MISSING']);
  });

  it('currency outside the table → no amount, cost still shown', () => {
    const v = offerValue(input({ priceCurrency: 'USD' }));
    expect(v).toMatchObject({ amount: null, detourCost: 420 });
    expect(v.codes).toContainEqual({ code: 'CURRENCY_CONVERSION_UNAVAILABLE', params: { from: 'USD', to: 'PLN' } });
  });
});

describe('compareByValue', () => {
  const item = (offerId: string, amount: number | null, detourKm: number) => ({
    offerId,
    value: { ...offerValue(input()), amount, detourKm },
  });

  it('higher amount first; tie → fewer detour km; then id; no amount last', () => {
    const items = [
      item('z-none-near', null, 10),
      item('b-tie-far', 500, 300),
      item('c-low', 100, 5),
      item('a-none-far', null, 50),
      item('d-tie-near', 500, 200),
      item('a-tie-near', 500, 200),
      item('e-high', 900.01, 900),
    ];
    expect(items.sort(compareByValue).map(i => i.offerId)).toEqual([
      'e-high', 'a-tie-near', 'd-tie-near', 'b-tie-far', 'c-low', 'z-none-near', 'a-none-far',
    ]);
  });

  it('exact values: 500.004 is above 500.001 (no rounding before sorting)', () => {
    const items = [item('a', 500.001, 1), item('b', 500.004, 1)];
    expect(items.sort(compareByValue).map(i => i.offerId)).toEqual(['b', 'a']);
  });
});

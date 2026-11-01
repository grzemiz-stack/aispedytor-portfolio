/**
 * LtlMatchingService — ranking part-load offers by PROFIT.
 *
 * Characterization test: pins the order and amount of every offer, so any
 * change to the formula, a rate or the toll shows up in this file's diff.
 *
 * Amount (ltl-matching/offer-value.ts), in the company's currency (PLN here):
 *  - with a cost per km: price − detour km × costPerKm − detour toll;
 *  - without it: price (revenue).
 * Rates from common/fx.ts: 1 EUR = 1 / 0.23 = 4.3478 PLN, 1 GBP = 1.15 / 0.23 = 5 PLN.
 * Sorted by the exact amount; tie → fewer detour km, then id.
 *
 * All offers: the same weight and length, no contractor. Trip Poznań →
 * Hamburg, coordinates as in ltl-detour.spec.ts. Vehicle: a 5+ combination.
 *
 * Why value and not points: a currency-blind points score would rank
 * 1150 GBP (5750 PLN) and 1200 EUR (5217 PLN) below 1200 PLN — see
 * docs/decisions.md §3.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

const POZNAN = { lat: 52.4064, lng: 16.9252 };
const BERLIN = { lat: 52.52, lng: 13.405 };
const HAMBURG = { lat: 53.5511, lng: 9.9937 };
const SZCZECIN = { lat: 53.4285, lng: 14.5528 };

const vehicle = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'PO 12345',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  maxPalletCount: 33,
  grossVehicleWeightKg: 40000,
  curbWeightKg: 15000,
  // A 5+ combination (2 + 3 axles): a route_calculations row for 5+ counts for the toll.
  vehicleCategory: 'TRUCK',
  axleCount: 2,
  trailers: [{ vehicleType: 'TRUCK', trailerType: 'CURTAIN', vehicleCategory: 'SEMI_TRAILER', axleCount: 3 }],
};

/** Default: return load Berlin → Poznań (597 km detour), 1200 PLN. */
const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  externalId: null,
  source: 'manual',
  pickupCity: 'Berlin',
  pickupCountry: 'DE',
  deliveryCity: 'Poznań',
  deliveryCountry: 'PL',
  pickupLat: BERLIN.lat,
  pickupLng: BERLIN.lng,
  deliveryLat: POZNAN.lat,
  deliveryLng: POZNAN.lng,
  weightKg: 1000,
  lengthM: 1.2,
  palletCount: 1,
  price: 1200,
  currency: 'PLN',
  pricePerKm: null,
  cargoType: 'Palety',
  contractor: null,
  ...over,
});

const noCoords = { pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null };

/** Order = database order (newest first). */
const OFFERS = [
  offer('return-pln-1200'),
  // The same number as above, but in EUR = 5217.39 PLN.
  offer('return-eur-1200', { currency: 'EUR' }),
  // A close price: 50 PLN more than return-pln-1200.
  offer('return-pln-1250', { price: 1250 }),
  // 1150 GBP = 5750 PLN — the most valuable offer in the set.
  offer('return-gbp-1150', { currency: 'GBP', price: 1150 }),
  // Like return-pln-1200, but with a calculated route for class 5+ — the only
  // offer whose detour toll is part of the cost (0.28894 EUR/km).
  offer('return-pln-1200-routecalc', {
    routeCalculations: [{
      distanceKm: 330,
      tollTotalEur: 95.35,
      tollTotalPln: 410,
      axleClass: '5+',
      axleClassDefaulted: false,
      tollNeedsVerification: false,
      calculatedAt: new Date('2026-09-30T10:00:00Z'),
    }],
  }),
  offer('onway-pln-400', {
    price: 400,
    deliveryCity: 'Hamburg',
    deliveryCountry: 'DE',
    deliveryLat: HAMBURG.lat,
    deliveryLng: HAMBURG.lng,
  }),
  offer('szczecin-eur-500', {
    currency: 'EUR',
    price: 500,
    deliveryCity: 'Szczecin',
    deliveryLat: SZCZECIN.lat,
    deliveryLng: SZCZECIN.lng,
  }),
  // No coordinates: outside the ranking (awaitingLocation), no guessed detour.
  offer('nocoords-eur-600', { currency: 'EUR', price: 600, ...noCoords }),
];

function makeService(offers: any[], costPerKm: number | null = null, providerRegistered = false) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue({ country: 'PL', costPerKm, costCurrency: 'PLN' }) },
  };
  const service = new LtlMatchingService(prisma, {} as any, providerRegistered ? ({ quote: jest.fn() } as any) : null);
  (service as any).geocode = jest
    .fn()
    .mockResolvedValueOnce(POZNAN)
    .mockResolvedValueOnce(HAMBURG);
  return { service, prisma };
}

/** Wide limits, so the detour filter cuts nothing. */
const SEARCH = {
  vehicleId: 'veh-1',
  routeFrom: 'Poznań',
  routeTo: 'Hamburg',
  currentLoadMeters: 0,
  currentLoadWeight: 0,
  maxDetourKm: 1000,
} as any;

/** A table row: what the forwarder sees on the card, in list order. */
async function ranking(costPerKm: number | null) {
  const { service } = makeService(OFFERS, costPerKm);
  const res = await service.findMatchingOffers('comp-1', SEARCH);
  return res.matches.map((m, i) => ({
    position: i + 1,
    offerId: m.offerId,
    currency: m.currency,
    price: m.price,
    detourKm: m.value.detourKm,
    amount: m.value.amount,
    detourCost: m.value.detourCost,
    detourToll: m.value.detourToll,
  }));
}

describe('LTL ranking by value — variant A: company without a cost per km (revenue in PLN)', () => {
  //   pos | offer                     | cur | price | km  | revenue PLN
  //   1   | return-gbp-1150           | GBP | 1150  | 597 | 5750.00
  //   2   | return-eur-1200           | EUR | 1200  | 597 | 5217.39
  //   3   | szczecin-eur-500          | EUR |  500  | 233 | 2173.91
  //   4   | return-pln-1250           | PLN | 1250  | 597 | 1250.00
  //   5   | return-pln-1200           | PLN | 1200  | 597 | 1200.00
  //   6   | return-pln-1200-routecalc | PLN | 1200  | 597 | 1200.00  (tie with 5 → id)
  //   7   | onway-pln-400             | PLN |  400  |  16 |  400.00
  it('pins the order and the revenue of every offer', async () => {
    expect(await ranking(null)).toEqual([
      { position: 1, offerId: 'return-gbp-1150', currency: 'GBP', price: 1150, detourKm: 597, amount: 5750, detourCost: null, detourToll: null },
      { position: 2, offerId: 'return-eur-1200', currency: 'EUR', price: 1200, detourKm: 597, amount: 5217.39, detourCost: null, detourToll: null },
      { position: 3, offerId: 'szczecin-eur-500', currency: 'EUR', price: 500, detourKm: 233, amount: 2173.91, detourCost: null, detourToll: null },
      { position: 4, offerId: 'return-pln-1250', currency: 'PLN', price: 1250, detourKm: 597, amount: 1250, detourCost: null, detourToll: null },
      { position: 5, offerId: 'return-pln-1200', currency: 'PLN', price: 1200, detourKm: 597, amount: 1200, detourCost: null, detourToll: null },
      { position: 6, offerId: 'return-pln-1200-routecalc', currency: 'PLN', price: 1200, detourKm: 597, amount: 1200, detourCost: null, detourToll: null },
      { position: 7, offerId: 'onway-pln-400', currency: 'PLN', price: 400, detourKm: 16, amount: 400, detourCost: null, detourToll: null },
    ]);
  });
});

describe('LTL ranking by value — variant B: cost 4.20 PLN/km (profit in PLN)', () => {
  // No toll provider registered: detour toll only where a provider-computed
  // route_calculations row matches (offer 7); elsewhere null with
  // TOLL_PROVIDER_NOT_CONFIGURED, and the profit excludes it.
  //   pos | offer                     | cur | price | km  | km cost  | toll   | profit PLN
  //   1   | return-gbp-1150           | GBP | 1150  | 597 | 2507.36  |   —    |  3242.64
  //   2   | return-eur-1200           | EUR | 1200  | 597 | 2507.36  |   —    |  2710.03
  //   3   | szczecin-eur-500          | EUR |  500  | 233 |  979.67  |   —    |  1194.24
  //   4   | onway-pln-400             | PLN |  400  |  16 |   68.53  |   —    |   331.47
  //   5   | return-pln-1250           | PLN | 1250  | 597 | 2507.36  |   —    | −1257.36
  //   6   | return-pln-1200           | PLN | 1200  | 597 | 2507.36  |   —    | −1307.36
  //   7   | return-pln-1200-routecalc | PLN | 1200  | 597 | 2507.36  | 749.97 | −2057.34
  // Toll of 7: route_calculations row for 5+: 95.35 / 330 = 0.28894 EUR/km;
  //   596.99 km × 0.28894 = 172.49 EUR / 0.23 = 749.97 PLN.
  it('pins the order, cost, toll and profit of every offer', async () => {
    expect(await ranking(4.2)).toEqual([
      { position: 1, offerId: 'return-gbp-1150', currency: 'GBP', price: 1150, detourKm: 597, amount: 3242.64, detourCost: 2507.36, detourToll: null },
      { position: 2, offerId: 'return-eur-1200', currency: 'EUR', price: 1200, detourKm: 597, amount: 2710.03, detourCost: 2507.36, detourToll: null },
      { position: 3, offerId: 'szczecin-eur-500', currency: 'EUR', price: 500, detourKm: 233, amount: 1194.24, detourCost: 979.67, detourToll: null },
      { position: 4, offerId: 'onway-pln-400', currency: 'PLN', price: 400, detourKm: 16, amount: 331.47, detourCost: 68.53, detourToll: null },
      { position: 5, offerId: 'return-pln-1250', currency: 'PLN', price: 1250, detourKm: 597, amount: -1257.36, detourCost: 2507.36, detourToll: null },
      { position: 6, offerId: 'return-pln-1200', currency: 'PLN', price: 1200, detourKm: 597, amount: -1307.36, detourCost: 2507.36, detourToll: null },
      { position: 7, offerId: 'return-pln-1200-routecalc', currency: 'PLN', price: 1200, detourKm: 597, amount: -2057.34, detourCost: 2507.36, detourToll: 749.97 },
    ]);
  });

  it('codes on the card: route toll where the row matches, TOLL_PROVIDER_NOT_CONFIGURED elsewhere', async () => {
    const { service } = makeService(OFFERS, 4.2);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    const byId = Object.fromEntries(res.matches.map(m => [m.offerId, m.value.codes.map(c => c.code)]));
    expect(byId['return-pln-1200-routecalc']).toEqual(['DETOUR_TOLL_ESTIMATED', 'FX_RATE_STATIC', 'LOAD_DOES_NOT_COVER_DETOUR']);
    expect(byId['return-gbp-1150']).toEqual(['TOLL_PROVIDER_NOT_CONFIGURED', 'FX_RATE_STATIC']);
    expect(res.notices.map(n => n.code)).toContain('TOLL_PROVIDER_NOT_CONFIGURED');
  });
});

describe('LTL ranking — an offer with a provider-computed route vs an identical one without', () => {
  /** Two identical offers Berlin → Poznań, 1200 PLN; one has a route_calculations row. */
  const pair = [
    offer('with-row', {
      routeCalculations: [{
        distanceKm: 330, tollTotalEur: 33, axleClass: '5+', axleClassDefaulted: false,
        tollNeedsVerification: false, calculatedAt: new Date('2026-09-30T10:00:00Z'),
      }],
    }),
    offer('without-row'),
  ];

  it('provider registered: the one without a calculated route has no toll (ROUTE_NOT_CALCULATED) and ranks higher — known limit', async () => {
    const { service } = makeService(pair, 4.2, true);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    expect(res.matches.map(m => [m.offerId, m.value.detourToll === null])).toEqual([['without-row', true], ['with-row', false]]);
    expect(res.matches[0].value.codes[0]).toEqual({ code: 'DETOUR_TOLL_NOT_INCLUDED', params: { reason: 'ROUTE_NOT_CALCULATED' } });
    expect(res.notices.map(n => n.code)).not.toContain('TOLL_PROVIDER_NOT_CONFIGURED');
  });
});

describe('LTL ranking — an offer without coordinates is not ranked', () => {
  // With a guessed 150 km detour nocoords-eur-600 would rank 3rd in both
  // variants. It is outside the list instead, in awaitingLocation.
  it.each([[null], [4.2]])('cost %p: nocoords-eur-600 awaits location, everything else is ranked', async cost => {
    const { service } = makeService(OFFERS, cost);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    expect(res.matches.map(m => m.offerId)).not.toContain('nocoords-eur-600');
    expect(res.matches).toHaveLength(7);
    expect(res.awaitingLocation.map(o => [o.offerId, o.reasons])).toEqual([
      ['nocoords-eur-600', [{ code: 'OFFER_AWAITING_LOCATION' }]],
    ]);
  });
});

describe('LTL ranking — currency-aware order', () => {
  it.each([[null], [4.2]])('cost %p: GBP 1150 and EUR 1200 rank before PLN 1250', async cost => {
    const ids = (await ranking(cost)).map(r => r.offerId);
    expect(ids.indexOf('return-gbp-1150')).toBeLessThan(ids.indexOf('return-pln-1250'));
    expect(ids.indexOf('return-eur-1200')).toBeLessThan(ids.indexOf('return-pln-1250'));
  });

  // Fit = (metres 2.65 + weight 1.04 + detour + contractor 5) / 85 × 100.
  // Return load: detour 8.06 → 19.7 → 20. On the way: 19.68 → 33.4 → 33.
  it('fitScore: without revenue, rescaled to 0–100, the same for every price and currency', async () => {
    const { service } = makeService(OFFERS, 4.2);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    const fit = Object.fromEntries(res.matches.map(m => [m.offerId, m.fitScore]));
    expect(fit['return-gbp-1150']).toBe(20);
    expect(fit['return-pln-1200']).toBe(20);
    expect(fit['onway-pln-400']).toBe(33);
    expect(res.matches[0].scoring).not.toHaveProperty('revenuePerKm');
  });

  // This company's blacklist = a block and the end of the list; the
  // COUNTERPARTY_RISK warning carries the other criteria (payment, reliability).
  it('counterparty risk: code on the card, the order by value; a blacklisted one last and blocked', async () => {
    const { service } = makeService([
      offer('safe-1100', { price: 1100, contractor: { id: 'k1', name: 'Pewny', reliabilityScore: 90, paymentRating: 5, isBlacklisted: false } }),
      offer('risky-1200', { price: 1200, contractor: { id: 'k2', companyId: 'comp-1', name: 'Ryzykowny', reliabilityScore: 10, paymentRating: 2, isBlacklisted: true } }),
      offer('unknown-1000', { price: 1000, contractor: { id: 'k3', name: 'Bez ocen', reliabilityScore: null, paymentRating: null, isBlacklisted: false } }),
    ]);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    expect(res.matches.map(m => m.offerId)).toEqual(['safe-1100', 'unknown-1000', 'risky-1200']);
    expect(res.matches.map(m => m.counterpartyRisk)).toEqual([
      null,
      null, // brak ocen to brak danych, nie ryzyko
      { code: 'COUNTERPARTY_RISK', params: { criteria: 'PAYMENT,RELIABILITY' } },
    ]);
    expect(res.matches.map(m => m.blockedBy.map(b => b.code))).toEqual([[], [], ['OFFER_CONTRACTOR_BLACKLISTED']]);
  });

  it('the offer query loads route_calculations for the toll, next to the contractor', async () => {
    const { service, prisma } = makeService(OFFERS);
    await service.findMatchingOffers('comp-1', SEARCH);
    expect(Object.keys(prisma.offer.findMany.mock.calls[0][0].include).sort()).toEqual(['contractor', 'routeCalculations']);
  });

  it('offers without an amount (no price, no rate) go last, after the 20 with an amount', async () => {
    const many = Array.from({ length: 22 }, (_, i) => offer(`pln-${String(i).padStart(2, '0')}`, { price: 1000 + i }));
    const { service } = makeService([
      offer('usd-900', { currency: 'USD', price: 900 }),
      offer('no-price', { price: null }),
      ...many,
    ], 4.2);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    const ids = res.matches.map(m => m.offerId);
    expect(ids).toHaveLength(22);
    // 20 with an amount, then two without — by detour km (equal), then id.
    expect(ids.slice(-2)).toEqual(['no-price', 'usd-900']);
    expect(res.hiddenWithoutAmount).toBe(0);
    const noPrice = res.matches.find(m => m.offerId === 'no-price')!.value;
    expect(noPrice.amount).toBeNull();
    expect(noPrice.thresholdPrice).toBe(2507.36); // km cost; toll unknown (no provider)
    expect(noPrice.codes.map(c => c.code)).toEqual(
      expect.arrayContaining(['OFFER_PRICE_MISSING', 'OFFER_THRESHOLD_PRICE']),
    );
  });

  it('offers without an amount: their own limit of 10, the rest counted as hidden', async () => {
    const noPrice = Array.from({ length: 13 }, (_, i) => offer(`np-${String(i).padStart(2, '0')}`, { price: null }));
    const { service } = makeService([offer('priced', { price: 1000 }), ...noPrice], 4.2);
    const res = await service.findMatchingOffers('comp-1', SEARCH);
    const ids = res.matches.map(m => m.offerId);
    // 1 with an amount + 10 without; the hidden ones come later in the order (here: by id).
    expect(ids).toEqual(['priced', ...noPrice.slice(0, 10).map(o => o.id)]);
    expect(res.hiddenWithoutAmount).toBe(3);
  });

  it('exactly 10 without an amount → nothing hidden', async () => {
    const noPrice = Array.from({ length: 10 }, (_, i) => offer(`np-${i}`, { price: null }));
    const res = await makeService(noPrice, 4.2).service.findMatchingOffers('comp-1', SEARCH);
    expect(res.matches).toHaveLength(10);
    expect(res.hiddenWithoutAmount).toBe(0);
  });
});

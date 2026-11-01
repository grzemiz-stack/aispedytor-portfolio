/**
 * Zero is a value, not missing data — on read paths: the LTL match result,
 * matching suggestions, negotiation analysis and the negotiation simulator.
 *
 * These are READS into a response, not writes to the database: a wrong value
 * is transient and disappears once the read is correct.
 *
 * Each case is also checked for a guard further along the value's path: fixing
 * the expression alone is not enough if a later truthiness test drops the 0.
 *
 * No network: geocoding and Prisma are fakes.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';
import { MatchingService } from '../../src/matching/matching.service';
import { NegotiationService } from '../../src/negotiation/negotiation.service';

// ── Rate per km in the LTL match result ──────────────────────────────────────

const ltlVehicle = {
  id: 'veh-1', companyId: 'comp-1', plateNumber: 'GD 12345',
  vehicleType: 'TRUCK', trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6, maxWeightKg: 24000, maxPalletCount: 33,
  grossVehicleWeightKg: 40000, curbWeightKg: 15000,
};

const ltlOffer = (over: Record<string, any> = {}) => ({
  id: 'off-1', companyId: 'comp-1', status: 'NEW',
  pickupCity: 'Poznań', pickupCountry: 'PL',
  deliveryCity: 'Berlin', deliveryCountry: 'DE',
  pickupLat: 52.4, pickupLng: 16.9, deliveryLat: 52.5, deliveryLng: 13.4,
  weightKg: 1000, lengthM: 1.0, palletCount: 2,
  price: 900, currency: 'EUR', pricePerKm: 1.5, cargoType: 'Palety', clientName: 'Klient',
  contractor: { id: 'k-1', name: 'Kontrahent', reliabilityScore: 80 },
  ...over,
});

function makeLtl(offerRows: any[]) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(ltlVehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offerRows) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const s = new LtlMatchingService(prisma, {} as any);
  (s as any).geocode = jest.fn()
    .mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 })
    .mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
  return s;
}

const ltlSearch = {
  vehicleId: 'veh-1', routeFrom: 'Poznań', routeTo: 'Berlin',
  currentLoadMeters: 0, currentLoadWeight: 0, maxDetourKm: 200,
} as any;

describe('LTL match result — rate of 0 EUR/km', () => {
  it('a rate of 0 is shown as 0, not as a missing rate', async () => {
    const { matches } = await makeLtl([ltlOffer({ pricePerKm: 0 })])
      .findMatchingOffers('comp-1', ltlSearch);

    expect(matches[0].pricePerKm).toBe(0);
  });

  it('a missing rate still gives null', async () => {
    const { matches } = await makeLtl([ltlOffer({ pricePerKm: null })])
      .findMatchingOffers('comp-1', ltlSearch);

    expect(matches[0].pricePerKm).toBeNull();
  });
});

// ── Price in a matching suggestion ───────────────────────────────────────────

const matchingVehicle = {
  id: 'veh-1', companyId: 'comp-1', name: 'Ciagnik', licensePlate: 'GD 1',
  vehicleType: 'TRUCK', status: 'AVAILABLE', maxWeightKg: 24000,
  currentCity: 'Poznań', currentCountry: 'PL', adrClasses: [],
  // Documents valid long after the loading (2030) — this test is about the price, not documents.
  technicalInspectionTo: new Date('2099-01-01'), insuranceTo: new Date('2099-01-01'),
  tachographLegalizationTo: new Date('2099-01-01'),
};

const matchingOffer = (over: Record<string, any> = {}) => ({
  id: 'off-1', companyId: 'comp-1', status: 'NEW',
  pickupCity: 'Poznań', pickupCountry: 'PL',
  deliveryCity: 'Berlin', deliveryCountry: 'DE',
  weightKg: 1000, price: 900, currency: 'EUR',
  isAdr: false, isFrigo: false, vehicleType: 'TRUCK',
  // Loading in the future: the matching lists drop offers whose loading day has passed.
  pickupDate: new Date('2030-10-01'),
  ...over,
});

function makeMatching(offerRows: any[]) {
  const prisma: any = {
    offer: { findMany: jest.fn().mockResolvedValue(offerRows) },
    vehicle: { findMany: jest.fn().mockResolvedValue([matchingVehicle]) },
  };
  return new MatchingService(prisma);
}

describe('matching suggestion — price of 0', () => {
  // A fake clock: the loading on 1.10.2030 must be in the future relative to NOW,
  // not to the real day — suggestions drop offers whose loading day has passed.
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2030-09-20T10:00:00Z')));
  afterAll(() => jest.useRealTimers());

  it('a price of 0 is shown as 0, not as a missing price', async () => {
    const suggestions = await makeMatching([matchingOffer({ price: 0 })]).getSuggestions('comp-1');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].offer.price).toBe(0);
  });

  it('a missing price still gives null', async () => {
    const suggestions = await makeMatching([matchingOffer({ price: null })]).getSuggestions('comp-1');

    expect(suggestions[0].offer.price).toBeNull();
  });
});

// ── Negotiation ──────────────────────────────────────────────────────────────

const negotiationOffer = (over: Record<string, any> = {}) => ({
  id: 'off-1', companyId: 'comp-1', status: 'NEW',
  pickupCity: 'Poznań', pickupCountry: 'PL',
  deliveryCity: 'Berlin', deliveryCountry: 'DE',
  // Loading in the future: the matching lists drop offers whose loading day has passed.
  pickupDate: new Date('2030-10-01'),
  distanceKm: 500, price: 900, pricePerKm: 1.8, currency: 'EUR',
  weightKg: 12000, cargoType: 'Palety', isAdr: false,
  contractorId: null, contractor: null, analysis: null,
  ...over,
});

function makeNegotiation(offerRow: any) {
  const prisma: any = {
    offer: {
      findFirst: jest.fn().mockResolvedValue(offerRow),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _avg: {}, _min: {}, _max: {}, _count: { id: 0 } }),
    },
    contractor: { findFirst: jest.fn().mockResolvedValue(null) },
    // Negotiation reads the saved route calculation; these tests are about prices,
    // so having no calculation is the right state here.
    // The company cost per km (offer cost = rate × km + toll).
    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
    routeCalculation: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return new NegotiationService(prisma);
}

describe('negotiation analysis — current offer price', () => {
  it('a price of 0 is shown as 0, not as a missing price', async () => {
    const r: any = await makeNegotiation(negotiationOffer({ price: 0 })).analyzeOffer('off-1', 'comp-1');

    expect(r.offer.currentPrice).toBe(0);
  });

  it('a missing price still gives null', async () => {
    const r: any = await makeNegotiation(negotiationOffer({ price: null })).analyzeOffer('off-1', 'comp-1');

    expect(r.offer.currentPrice).toBeNull();
  });
});

describe('negotiation analysis — market comparison of a price of 0', () => {
  it('a free offer is rated below market, not "market"', async () => {
    // `if (currentPrice && priceSuggestion.avgPrice > 0)` — a truthiness test here
    // would undo the zero-price fix: a price of 0 would skip the market
    // comparison and a free offer would look like a market-rate offer.
    const service = makeNegotiation(negotiationOffer({ price: 0 }));
    (service as any).getPriceSuggestion = jest.fn().mockResolvedValue({
      avgPrice: 1000, optimalPrice: 1000, minPrice: 800, maxPrice: 1200,
      medianPrice: 1000, confidence: 50, sampleSize: 10,
      percentiles: { p25: 900, p50: 1000, p75: 1100 },
    });

    const r: any = await service.analyzeOffer('off-1', 'comp-1');

    expect(r.marketPosition).toBe('below');
    expect(r.marketPositionPct).toBe(-100);
  });
});

describe('negotiation analysis — rate per km', () => {
  it('a rate of 0 is shown as 0, not as a missing rate', async () => {
    const r: any = await makeNegotiation(negotiationOffer({ pricePerKm: 0 })).analyzeOffer('off-1', 'comp-1');

    expect(r.offer.pricePerKm).toBe(0);
  });

  it('a missing rate still gives null', async () => {
    const r: any = await makeNegotiation(negotiationOffer({ pricePerKm: null })).analyzeOffer('off-1', 'comp-1');

    expect(r.offer.pricePerKm).toBeNull();
  });
});

describe('simulateNegotiation — contractor price of 0', () => {
  it('the "Cena kontrahenta" (contractor price) scenario shows 0, not the price the user proposed', async () => {
    // With `offer.price ? Number(offer.price) : proposedPrice`, a price of 0 would make
    // the scenario labelled as the contractor price show the number the user entered.
    //
    // `tollCostEstimate` is here so that the simulator computes scenarios at all:
    // without a known toll it returns an empty list (docs/decisions.md §5).
    // This test is about the price, not the toll.
    const service = makeNegotiation(negotiationOffer({ price: 0, tollCostEstimate: 400 }));
    (service as any).getPriceSuggestion = jest.fn().mockResolvedValue({
      avgPrice: 1000, optimalPrice: 1000, minPrice: 800, maxPrice: 1200,
      medianPrice: 1000, confidence: 50, sampleSize: 10,
      percentiles: { p25: 900, p50: 1000, p75: 1100 },
    });

    const r: any = await service.simulateNegotiation('off-1', 750, 'comp-1');
    const contractorScenario = r.scenarios.find((s: any) => s.label === 'Cena kontrahenta');

    expect(contractorScenario.price).toBe(0);
  });
});

// ── Contractor scoring: a rating of 0 is the worst rating, no rating is neutral ──

describe('contractorScore — a rating of 0 scores lowest, no rating scores neutral', () => {
  /** Three offers that differ ONLY in the contractor — the rest of the scoring is identical. */
  const threeContractors = () => makeLtl([
    ltlOffer({ id: 'off-zero',  contractor: { id: 'k-0', name: 'Zerowy',    reliabilityScore: 0 } }),
    ltlOffer({ id: 'off-sredni', contractor: { id: 'k-1', name: 'Sredni',    reliabilityScore: 30 } }),
    ltlOffer({ id: 'off-brak',  contractor: null, clientName: 'Bez oceny' }),
  ]);

  // Contractor points directly (0–10). They do not affect the list order —
  // the ranking is by profit (docs/decisions.md §3); the contractor counts only in fitScore.
  const contractorPointsOf = (matches: any[], id: string) => matches.find((m) => m.offerId === id).scoring.contractorScore;
  const fitScoreOf = (matches: any[], id: string) => matches.find((m) => m.offerId === id).fitScore;

  it('a contractor rated 0 scores below a contractor rated 30', async () => {
    // If a rating of 0 were treated as missing it would get 5 points (the neutral
    // default) while a rating of 30 gets 3 — the worst contractor would beat an average one by 2.
    const { matches } = await threeContractors().findMatchingOffers('comp-1', ltlSearch);

    expect(contractorPointsOf(matches, 'off-sredni')).toBeGreaterThan(contractorPointsOf(matches, 'off-zero'));
  });

  it('a rating of 0 gives 0 points and no rating gives 5 — a difference of 5', async () => {
    const { matches } = await threeContractors().findMatchingOffers('comp-1', ltlSearch);

    expect(contractorPointsOf(matches, 'off-brak') - contractorPointsOf(matches, 'off-zero')).toBe(5);
  });

  it('fitScore orders them: no rating > rated 30 > rated 0', async () => {
    const { matches } = await threeContractors().findMatchingOffers('comp-1', ltlSearch);

    expect(fitScoreOf(matches, 'off-brak')).toBeGreaterThan(fitScoreOf(matches, 'off-sredni'));
    expect(fitScoreOf(matches, 'off-sredni')).toBeGreaterThan(fitScoreOf(matches, 'off-zero'));
  });

  it('no contractor still scores neutral, above a rating of 30', async () => {
    // Counter-check: a missing rating must not be treated like a rating of 0.
    const { matches } = await threeContractors().findMatchingOffers('comp-1', ltlSearch);

    expect(contractorPointsOf(matches, 'off-brak')).toBeGreaterThan(contractorPointsOf(matches, 'off-sredni'));
  });

  it('a high rating still scores proportionally', async () => {
    const { matches } = await makeLtl([
      ltlOffer({ id: 'off-wysoki', contractor: { id: 'k-9', name: 'Solidny', reliabilityScore: 100 } }),
      ltlOffer({ id: 'off-brak',   contractor: null, clientName: 'Bez oceny' }),
    ]).findMatchingOffers('comp-1', ltlSearch);

    // 100/100*10 = 10 points against the default 5
    expect(contractorPointsOf(matches, 'off-wysoki') - contractorPointsOf(matches, 'off-brak')).toBe(5);
  });
});

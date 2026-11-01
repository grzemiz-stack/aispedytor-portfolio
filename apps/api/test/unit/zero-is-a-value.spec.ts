/**
 * Zero is a value, not missing data (docs/decisions.md §2) — on the offer
 * import path numeric fields must not go through `value || null`.
 *
 * T1: importing an offer keeps `temperatureMin: 0` — 0°C is one of the most
 *     common temperatures in reefer transport and must not be stored as NULL.
 * T2: further down the chain — RiskAnalysisService reads the same column with
 *     the rule `temperatureMin != null`, so a 0°C load is recognised as needing
 *     a reefer.
 * T3: `reliabilityScore: 0` (the worst possible score in the documented range
 *     0-100) is shown as 0, not as "no score".
 *
 * No I/O: Prisma and geocoding are fakes.
 */
import { OffersService } from '../../src/offers/offers.service';
import { RiskAnalysisService } from '../../src/risk-analysis/risk-analysis.service';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

// ── T1/T2: offer import ──────────────────────────────────────────────────────

const rawOffer = (over: Record<string, any> = {}): any => ({
  externalId: 'TRN-001',
  pickupCity: 'Warszawa',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  pickupDate: '2026-09-10',
  price: 1200,
  currency: 'EUR',
  weightKg: 12000,
  ...over,
});

function makeOffers() {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    offer: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const demandsService: any = { checkNewOfferAgainstDemands: jest.fn().mockResolvedValue([]) };
  const cache: any = { deleteByPrefix: jest.fn() };
  const taskQueue: any = { enqueue: (fn: () => any) => Promise.resolve(fn()) };
  return { service: new OffersService(prisma, demandsService, cache, taskQueue), prisma };
}

/** The row prepared for saving — exactly what goes to createMany. */
const rowToSave = (prisma: any) => prisma.offer.createMany.mock.calls[0][0].data[0];

describe('T1 — importing a reefer offer at 0°C', () => {
  it('temperatureMin = 0 is stored as 0, not NULL', async () => {
    const { service, prisma } = makeOffers();

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer({ isFrigo: true, temperatureMin: 0, temperatureMax: 4 })],
    } as any);

    expect(rowToSave(prisma).temperatureMin).toBe(0);
  });

  it('temperatureMax = 0 is stored as 0, not NULL', async () => {
    const { service, prisma } = makeOffers();

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer({ isFrigo: true, temperatureMin: -18, temperatureMax: 0 })],
    } as any);

    expect(rowToSave(prisma).temperatureMax).toBe(0);
  });

  it('a missing temperature is still stored as NULL', async () => {
    const { service, prisma } = makeOffers();

    await service.importOffers('comp-1', { source: 'transeu', offers: [rawOffer()] } as any);

    const savedRow = rowToSave(prisma);
    expect(savedRow.temperatureMin).toBeNull();
    expect(savedRow.temperatureMax).toBeNull();
  });

  it('a negative temperature passes unchanged', async () => {
    const { service, prisma } = makeOffers();

    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer({ temperatureMin: -18 })],
    } as any);

    expect(rowToSave(prisma).temperatureMin).toBe(-18);
  });
});

// ── T2: effect on risk analysis ──────────────────────────────────────────────

function makeRisk(offer: Record<string, any>) {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    offer: { findFirst: jest.fn().mockResolvedValue(offer) },
    vehicle: {
      findMany: jest.fn().mockResolvedValue([]), // fleet without a reefer
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const queue: any = { enqueue: (fn: () => Promise<any>) => fn() };
  return new RiskAnalysisService(prisma, queue);
}

describe('T2 — a 0°C offer goes through the import into risk analysis', () => {
  it('the row saved by the import is recognised as needing a reefer (NO_FRIGO_VEHICLE)', async () => {
    // The chain: what the import prepared for saving is what the analysis later reads.
    const { service, prisma } = makeOffers();
    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer({ isFrigo: false, temperatureMin: 0, temperatureMax: 0 })],
    } as any);

    const importedRow = {
      ...rowToSave(prisma),
      id: 'off-1',
      notes: null,
      specialRequirements: null,
      penaltyClauses: null,
      palletExchange: false,
      isAdr: false,
    };

    const riskResult = await makeRisk(importedRow).analyzeRisk('off-1', 'comp-1');

    expect(riskResult.risks.map((r) => r.type)).toContain('NO_FRIGO_VEHICLE');
  });

  it('the message gives the temperature range, not empty brackets', async () => {
    const { service, prisma } = makeOffers();
    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer({ temperatureMin: 0, temperatureMax: 4 })],
    } as any);

    const importedRow = {
      ...rowToSave(prisma),
      id: 'off-1',
      notes: null, specialRequirements: null, penaltyClauses: null,
      palletExchange: false, isAdr: false,
    };

    const riskResult = await makeRisk(importedRow).analyzeRisk('off-1', 'comp-1');
    const frigo = riskResult.risks.find((r) => r.type === 'NO_FRIGO_VEHICLE');

    expect(frigo!.message).toContain('0°C / 4°C');
  });
});

// ── T3: contractor score ─────────────────────────────────────────────────────

const vehicle = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'GD 12345',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  maxPalletCount: 33,
  grossVehicleWeightKg: 40000,
  curbWeightKg: 15000,
};

const ltlOffer = (over: Record<string, any> = {}) => ({
  id: 'off-1',
  companyId: 'comp-1',
  status: 'NEW',
  pickupCity: 'Poznań',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  pickupLat: 52.4, pickupLng: 16.9,
  deliveryLat: 52.5, deliveryLng: 13.4,
  weightKg: 1000,
  lengthM: 1.0,
  palletCount: 2,
  price: 900,
  currency: 'EUR',
  pricePerKm: 1.5,
  cargoType: 'Palety',
  clientName: 'Klient',
  contractor: { id: 'k-1', name: 'Kontrahent', reliabilityScore: 80 },
  ...over,
});

function makeLtl(offers: any[]) {
  const prisma: any = {
    routeCalculation: { findFirst: async () => null },
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  (service as any).geocode = jest
    .fn()
    .mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 })
    .mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
  return service;
}

const search = {
  vehicleId: 'veh-1',
  routeFrom: 'Poznań',
  routeTo: 'Berlin',
  currentLoadMeters: 0,
  currentLoadWeight: 0,
  maxDetourKm: 200,
} as any;

describe('T3 — contractor reliability score', () => {
  it('a score of 0 is shown as 0, not as no score', async () => {
    // reliabilityScore has the schema comment `// 0-100`: zero is the worst
    // possible score, not missing data. Hiding it hides the worst case.
    const service = makeLtl([ltlOffer({
      contractor: { id: 'k-1', name: 'Niepewny', reliabilityScore: 0 },
    })]);

    const { matches } = await service.findMatchingOffers('comp-1', search);

    expect(matches).toHaveLength(1);
    expect(matches[0].contractorReliability).toBe(0);
  });

  it('a contractor without a score still gives null', async () => {
    const service = makeLtl([ltlOffer({
      contractor: { id: 'k-1', name: 'Nieoceniony', reliabilityScore: null },
    })]);

    const { matches } = await service.findMatchingOffers('comp-1', search);

    expect(matches[0].contractorReliability).toBeNull();
  });

  it('an offer without a contractor gives null', async () => {
    const service = makeLtl([ltlOffer({ contractor: null })]);

    const { matches } = await service.findMatchingOffers('comp-1', search);

    expect(matches[0].contractorReliability).toBeNull();
  });

  it('a non-zero score passes unchanged', async () => {
    const service = makeLtl([ltlOffer({
      contractor: { id: 'k-1', name: 'Solidny', reliabilityScore: 95 },
    })]);

    const { matches } = await service.findMatchingOffers('comp-1', search);

    expect(matches[0].contractorReliability).toBe(95);
  });
});

// ── remaining numeric columns of the import path ─────────────────────────────

describe('import — zero reaches the write layer, not NULL', () => {
  const importWith = async (over: Record<string, any>) => {
    const { service, prisma } = makeOffers();
    await service.importOffers('comp-1', {
      source: 'transeu',
      offers: [rawOffer(over)],
    } as any);
    return rowToSave(prisma);
  };

  it('weight 0 kg is stored as 0', async () => {
    expect((await importWith({ weightKg: 0 })).weightKg).toBe(0);
  });

  it('volume 0 m3 is stored as 0', async () => {
    expect((await importWith({ volumeM3: 0 })).volumeM3).toBe(0);
  });

  it('price 0 is stored as 0', async () => {
    expect((await importWith({ price: 0 })).price).toBe(0);
  });

  it('rate 0 EUR/km is stored as 0', async () => {
    expect((await importWith({ pricePerKm: 0 })).pricePerKm).toBe(0);
  });

  it('distance 0 km is stored as 0', async () => {
    expect((await importWith({ distanceKm: 0 })).distanceKm).toBe(0);
  });

  it('a given rate of 0 is not overwritten by one computed from price and distance', async () => {
    // A guard like `if (!pricePerKm && ...)` would treat the given 0 as missing
    // and recompute the rate from the price — overwriting what the source sent.
    const savedRow = await importWith({ pricePerKm: 0, price: 1200, distanceKm: 500 });

    expect(savedRow.pricePerKm).toBe(0);
  });

  it('a free offer with a known distance gets rate 0, not NULL', async () => {
    // A guard requiring `normalized.price &&` would let a price of 0 block the
    // rate calculation — although 0 / 500 is a valid rate of 0 EUR/km.
    const savedRow = await importWith({ price: 0, distanceKm: 500, pricePerKm: undefined });

    expect(savedRow.price).toBe(0);
    expect(savedRow.pricePerKm).toBe(0);
  });

  it('without a price the rate is still not computed', async () => {
    const savedRow = await importWith({ price: undefined, distanceKm: 500, pricePerKm: undefined });

    expect(savedRow.pricePerKm).toBeNull();
  });

  it('distance 0 does not lead to division by zero', async () => {
    const savedRow = await importWith({ price: 1200, distanceKm: 0, pricePerKm: undefined });

    expect(savedRow.distanceKm).toBe(0);
    expect(savedRow.pricePerKm).toBeNull();
  });

  it('missing values are still stored as NULL', async () => {
    const savedRow = await importWith({ weightKg: undefined, price: undefined });

    expect(savedRow.weightKg).toBeNull();
    expect(savedRow.price).toBeNull();
    expect(savedRow.volumeM3).toBeNull();
    expect(savedRow.distanceKm).toBeNull();
  });

  it('non-zero values pass unchanged', async () => {
    const savedRow = await importWith({ weightKg: 12000, price: 1200, distanceKm: 500 });

    expect(savedRow.weightKg).toBe(12000);
    expect(savedRow.price).toBe(1200);
    expect(savedRow.distanceKm).toBe(500);
    expect(savedRow.pricePerKm).toBe(2.4); // computed, because the source gave no rate
  });
});

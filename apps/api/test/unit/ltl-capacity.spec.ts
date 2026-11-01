/**
 * LtlMatchingService — capacity check for part loads.
 *
 * Missing weight must NOT pass as 0 in the capacity calculation. Zero
 * kilograms says "this load weighs nothing" and lets the offer through the
 * check; missing data must exclude the offer from the calculation, not pose
 * as a light load.
 *
 * No network: the private `geocode` (Nominatim) is replaced by a constant,
 * `fetch` is untouched.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

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

const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  pickupCity: 'Poznań',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  pickupLat: 52.4,
  pickupLng: 16.9,
  deliveryLat: 52.5,
  deliveryLng: 13.4,
  weightKg: 3000,
  lengthM: 2.4,
  palletCount: 2,
  price: 900,
  currency: 'EUR',
  pricePerKm: 1.5,
  cargoType: 'Palety',
  contractor: { id: 'k-1', name: 'Kontrahent', reliabilityScore: 80 },
  ...over,
});

function makeService(offers: any[]) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  // Route Poznan -> Berlin, no network.
  (service as any).geocode = jest
    .fn()
    .mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 })
    .mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
  return { service, prisma };
}

/** Vehicle loaded with 22 t of 24 t — 2 tonnes left for an extra load. */
const search = {
  vehicleId: 'veh-1',
  routeFrom: 'Poznań',
  routeTo: 'Berlin',
  currentLoadMeters: 8,
  currentLoadWeight: 22,
  maxDetourKm: 200,
} as any;

describe('findMatchingOffers — 2 t of free capacity', () => {
  it('baseline: exactly 2 tonnes are left', async () => {
    const { service } = makeService([]);
    const res = await service.findMatchingOffers('comp-1', search);

    expect(res.capacity.maxWeightKg).toBe(24000);
    expect(res.capacity.currentLoadWeightKg).toBe(22000);
    expect(res.capacity.freeWeightKg).toBe(2000);
  });

  it('an offer of a known 10 t is rejected — it does not fit in 2 t', async () => {
    const { service } = makeService([offer('ciezka', { weightKg: 10000 })]);
    const res = await service.findMatchingOffers('comp-1', search);

    expect(res.matches.map((m: any) => m.offerId)).toEqual([]);
  });

  it('an offer of 1.5 t is accepted — it fits in 2 t', async () => {
    const { service } = makeService([offer('lekka', { weightKg: 1500 })]);
    const res = await service.findMatchingOffers('comp-1', search);

    expect(res.matches.map((m: any) => m.offerId)).toEqual(['lekka']);
  });

  it('an offer WITHOUT a weight cannot pass the check as weightless', async () => {
    // The same 10 t load, whose weight could not be parsed on import. With
    // `offer.weightKg || 0` missing data would become 0 kg, pass `0 > 2000` and
    // reach the dispatcher as a candidate.
    const { service } = makeService([offer('bez-masy', { weightKg: null })]);
    const res = await service.findMatchingOffers('comp-1', search);

    expect(res.matches.map((m: any) => m.offerId)).toEqual([]);
  });

  it('an offer of 0 kg stays a value and passes', async () => {
    const { service } = makeService([offer('zerowa', { weightKg: 0 })]);
    const res = await service.findMatchingOffers('comp-1', search);

    expect(res.matches.map((m: any) => m.offerId)).toEqual(['zerowa']);
  });

  it('an offer without a weight is reported as unmeasurable', async () => {
    const { service } = makeService([offer('bez-masy', { weightKg: null })]);
    const res: any = await service.findMatchingOffers('comp-1', search);

    expect(res.unmeasurable).toMatchObject([{ offerId: 'bez-masy', missing: ['weightKg'] }]);
  });
});

describe('findMatchingOffers — missing dimensions', () => {
  // Plenty of free weight, so only the dimensions decide.
  const lightVehicle = { ...search, currentLoadWeight: 2, currentLoadMeters: 5 };

  it('an offer without length or pallet count does not get a default 2.4 m', async () => {
    // `lengthM || 2.4` would invent 2.4 m and pass the space check on a
    // dimension nobody gave.
    const { service } = makeService([
      offer('bez-wymiarow', { weightKg: 1000, lengthM: null, palletCount: null }),
    ]);
    const res: any = await service.findMatchingOffers('comp-1', lightVehicle);

    expect(res.matches.map((m: any) => m.offerId)).toEqual([]);
    expect(res.unmeasurable).toMatchObject([{ offerId: 'bez-wymiarow', missing: ['dimensions'] }]);
  });

  it('length derived from the pallet count still works', async () => {
    const { service } = makeService([offer('z-palet', { weightKg: 1000, lengthM: null, palletCount: 2 })]);
    const res = await service.findMatchingOffers('comp-1', lightVehicle);

    expect(res.matches.map((m: any) => m.offerId)).toEqual(['z-palet']);
  });

  it('missing weight and missing dimensions are reported together', async () => {
    const { service } = makeService([
      offer('nic', { weightKg: null, lengthM: null, palletCount: null }),
    ]);
    const res: any = await service.findMatchingOffers('comp-1', lightVehicle);

    expect(res.unmeasurable).toMatchObject([
      { offerId: 'nic', missing: ['weightKg', 'dimensions'] },
    ]);
  });

  it('complete data is not listed as unmeasurable', async () => {
    const { service } = makeService([offer('ok', { weightKg: 1000 })]);
    const res: any = await service.findMatchingOffers('comp-1', lightVehicle);

    expect(res.matches).toHaveLength(1);
    expect(res.unmeasurable).toEqual([]);
  });

  it('a roomy vehicle does not change the rule for an offer without a weight', async () => {
    const { service } = makeService([offer('bez-masy', { weightKg: null })]);
    const res: any = await service.findMatchingOffers('comp-1', {
      ...search,
      currentLoadWeight: 0,
      currentLoadMeters: 0,
    });

    expect(res.matches).toEqual([]);
    expect(res.unmeasurable[0].missing).toContain('weightKg');
  });
});

describe('the free capacity at its edges', () => {
  const ids = async (o: any[]) => (await makeService(o).service.findMatchingOffers('comp-1', search)).matches.map((m: any) => m.offerId);

  it('weight: exactly the free 2000 kg fits, 2001 kg does not', async () => {
    expect([await ids([offer('2000', { weightKg: 2000 })]), await ids([offer('2001', { weightKg: 2001 })])]).toEqual([['2000'], []]);
  });

  it('length: exactly the free 5.6 m fits, 5.7 m does not (13.6 m − 8 m loaded)', async () => {
    // 1 t, so that only the length decides (the default offer weighs 3 t > the free 2 t).
    expect([await ids([offer('5.6', { weightKg: 1000, lengthM: 5.6, palletCount: null })]), await ids([offer('5.7', { weightKg: 1000, lengthM: 5.7, palletCount: null })])]).toEqual([['5.6'], []]);
  });
});

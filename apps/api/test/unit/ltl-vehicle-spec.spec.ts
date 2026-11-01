/**
 * LtlMatchingService — a vehicle record without capacity.
 *
 * Naming: `maxWeightKg` is the CAPACITY (how much may be loaded), not the GVW.
 * The combination's GVW is a separate field, `grossVehicleWeightKg` — see
 * test/unit/ltl-dmc.spec.ts.
 *
 * A missing `maxWeightKg` is an incomplete vehicle record, not a reason to
 * guess: every path refuses instead of substituting its own default.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

const withoutGvw = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'WA 00000',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6,
  maxWeightKg: null,
  maxPalletCount: 33,
  grossVehicleWeightKg: 40000,
  curbWeightKg: 15000,
};

const withGvw = { ...withoutGvw, plateNumber: 'WA 11111', maxWeightKg: 24000 };
const withoutLoadingMeters = { ...withGvw, plateNumber: 'WA 22222', maxLoadingMeters: null };

function makeService(vehicle: any) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  (service as any).geocode = jest
    .fn()
    .mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 })
    .mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
  return { service, prisma };
}

const search = {
  vehicleId: 'veh-1',
  routeFrom: 'Poznań',
  routeTo: 'Berlin',
  currentLoadMeters: 0,
  currentLoadWeight: 0,
  maxDetourKm: 200,
} as any;

const loadPlan = {
  vehicleId: 'veh-1',
  loads: [
    { offerId: 'o1', description: 'Palety', loadingCity: 'Poznań', unloadingCity: 'Berlin', weight: 5000, meters: 3.2 },
  ],
} as any;


describe('vehicle without maxWeightKg — no path substitutes a number', () => {
  // The same empty field must not give different readings on different
  // paths: each of them refuses instead of guessing.
  it.each([
    ['getVehicleCapacity', (s: LtlMatchingService) => s.getVehicleCapacity('veh-1', 'comp-1', 0, 0)],
    ['findMatchingOffers', (s: LtlMatchingService) => s.findMatchingOffers('comp-1', search)],
    ['calculateLoadPlan', (s: LtlMatchingService) => s.calculateLoadPlan('comp-1', loadPlan)],
  ])('%s returns no capacity number', async (_label, callPath) => {
    const { service } = makeService(withoutGvw);

    await expect(callPath(service)).rejects.toThrow(/kartoteka pojazdu/i);
  });
});

describe('vehicle with a capacity — one field, one number on every path', () => {
  it('getVehicleCapacity takes the capacity straight from the record', async () => {
    const { service } = makeService(withGvw);
    const capacity = await service.getVehicleCapacity('veh-1', 'comp-1', 0, 0);

    expect(capacity.maxWeightKg).toBe(24000);
    expect(capacity.freeWeightKg).toBe(24000);
  });

  it('a different capacity flows from the record', async () => {
    const { service } = makeService({ ...withGvw, maxWeightKg: 18000 });

    const capacity = await service.getVehicleCapacity('veh-1', 'comp-1', 0, 0);

    expect(capacity.maxWeightKg).toBe(18000);
    expect(capacity.freeWeightKg).toBe(18000);
  });
});

describe('vehicle without maxWeightKg — missing capacity blocks the calculation', () => {
  it('getVehicleCapacity refuses to compute capacity', async () => {
    const { service } = makeService(withoutGvw);

    await expect(service.getVehicleCapacity('veh-1', 'comp-1', 0, 0)).rejects.toThrow(
      /kartoteka pojazdu/i,
    );
  });

  it('the refusal names the missing field and the vehicle', async () => {
    const { service } = makeService(withoutGvw);

    await service.getVehicleCapacity('veh-1', 'comp-1', 0, 0).then(
      () => {
        throw new Error('Oczekiwano odmowy wyliczenia');
      },
      (err: any) => {
        expect(err.getResponse()).toMatchObject({
          error: 'IncompleteVehicleRecord',
          vehicleId: 'veh-1',
          plateNumber: 'WA 00000',
          missing: ['maxWeightKg'],
        });
      },
    );
  });

  it('findMatchingOffers returns no matches for an incomplete record', async () => {
    const { service } = makeService(withoutGvw);

    await expect(service.findMatchingOffers('comp-1', search)).rejects.toThrow(
      /kartoteka pojazdu/i,
    );
  });

  it('calculateLoadPlan refuses the same way', async () => {
    const { service } = makeService(withoutGvw);

    await expect(service.calculateLoadPlan('comp-1', loadPlan)).rejects.toThrow(
      /kartoteka pojazdu/i,
    );
  });

  it('a vehicle with a complete record is computed normally', async () => {
    const { service } = makeService(withGvw);
    const plan = await service.calculateLoadPlan('comp-1', loadPlan);

    expect(plan.maxWeightKg).toBe(24000);
    expect(plan.totalWeightKg).toBe(5000);
  });
});

describe('vehicle without maxLoadingMeters — length cannot be guessed either', () => {
  // A default of 13.6 m would make the "metres vs max_loading_meters" check
  // compare against a made-up number.
  it.each([
    ['getVehicleCapacity', (s: LtlMatchingService) => s.getVehicleCapacity('veh-1', 'comp-1', 0, 0)],
    ['findMatchingOffers', (s: LtlMatchingService) => s.findMatchingOffers('comp-1', search)],
    ['calculateLoadPlan', (s: LtlMatchingService) => s.calculateLoadPlan('comp-1', loadPlan)],
    ['optimizeLoadPlan', (s: LtlMatchingService) => s.optimizeLoadPlan('comp-1', loadPlan)],
  ])('%s refuses instead of substituting 13.6 m', async (_label, callPath) => {
    const { service } = makeService(withoutLoadingMeters);

    await expect(callPath(service)).rejects.toThrow(/kartoteka pojazdu/i);
  });

  it('the refusal names the missing length field', async () => {
    const { service } = makeService(withoutLoadingMeters);

    await service.getVehicleCapacity('veh-1', 'comp-1', 0, 0).then(
      () => {
        throw new Error('Oczekiwano odmowy wyliczenia');
      },
      (err: any) => {
        expect(err.getResponse()).toMatchObject({
          error: 'IncompleteVehicleRecord',
          plateNumber: 'WA 22222',
          missing: ['maxLoadingMeters'],
        });
      },
    );
  });
});

/**
 * Reefer detection in `matching` and `risk-analysis`.
 *
 * Characterization test. The seed data (`seed.ts`) stores a reefer as
 * `vehicleType TRUCK` + `trailerType REEFER`. Both modules use the shared
 * rule from `common/reefer.ts` — the same one as the LTL filters.
 */
import { MatchingService } from '../../src/matching/matching.service';
import { RiskAnalysisService } from '../../src/risk-analysis/risk-analysis.service';

const TRUCK_REEFER = { vehicleType: 'TRUCK', trailerType: 'REEFER' };
const REFRIGERATED = { vehicleType: 'REFRIGERATED', trailerType: null };
const CURTAIN = { vehicleType: 'TRUCK', trailerType: 'CURTAIN' };

const FROZEN = { isFrigo: true, temperatureMin: -20, temperatureMax: -18 };
const TEMPERATURE_ONLY = { isFrigo: false, temperatureMin: 2, temperatureMax: 6 };
const NORMAL = { isFrigo: false, temperatureMin: null, temperatureMax: null };

describe('matching — type score (30 pts)', () => {
  const typeScore = (vehicle: object, offer: object): number =>
    (new MatchingService({} as any) as any).calcTypeMatch(vehicle, offer);

  it.each([
    ['REFRIGERATED + reefer load', REFRIGERATED, FROZEN, 30],
    ['TRUCK+REEFER + reefer load', TRUCK_REEFER, FROZEN, 30],
    ['tractor with a reefer trailer record + reefer load', { ...CURTAIN, trailers: [TRUCK_REEFER] }, FROZEN, 30],
    ['curtain + reefer load', CURTAIN, FROZEN, 0],
    ['REFRIGERATED + normal load', REFRIGERATED, NORMAL, 20],
    ['TRUCK+REEFER + normal load', TRUCK_REEFER, NORMAL, 20],
    ['curtain + normal load', CURTAIN, NORMAL, 30],
    ['REFRIGERATED + temperature without isFrigo', REFRIGERATED, TEMPERATURE_ONLY, 30],
    ['curtain + temperature without isFrigo', CURTAIN, TEMPERATURE_ONLY, 0],
  ])('%s → %p', (_label, vehicle, offer, expected) => {
    expect(typeScore(vehicle, offer)).toBe(expected);
  });
});

describe('risk-analysis — "no reefer in the fleet"', () => {
  function analyze(vehicles: object[], offer: object) {
    const prisma: any = {
      offer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'off-1', companyId: 'comp-1', pickupCountry: 'PL', deliveryCountry: 'PL',
          pickupDate: new Date('2026-06-01'), isAdr: false, adrClass: null, palletExchange: false,
          ...offer,
        }),
      },
      vehicle: {
        findMany: jest.fn().mockResolvedValue(vehicles),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const queue: any = { enqueue: (fn: () => Promise<any>) => fn() };
    return { run: () => new RiskAnalysisService(prisma, queue).analyzeRisk('off-1', 'comp-1'), prisma };
  }
  const flagged = async (vehicles: object[], offer: object) =>
    (await analyze(vehicles, offer).run()).risks.some((r: any) => r.type === 'NO_FRIGO_VEHICLE');

  it('fleet with a REFRIGERATED vehicle → no risk', async () => {
    expect(await flagged([REFRIGERATED], FROZEN)).toBe(false);
  });

  it('fleet whose only reefer is TRUCK+REEFER → no risk', async () => {
    expect(await flagged([TRUCK_REEFER], FROZEN)).toBe(false);
  });

  it('fleet whose reefer is a trailer record → no risk', async () => {
    expect(await flagged([CURTAIN, { vehicleType: 'TRUCK', trailerType: 'REEFER' }], TEMPERATURE_ONLY)).toBe(false);
  });

  it('fleet without any reefer → still flagged', async () => {
    expect(await flagged([CURTAIN], FROZEN)).toBe(true);
  });

  it('the fleet query reads trailerType — without it the rule sees nothing on a real database', async () => {
    const a = analyze([], NORMAL);
    await a.run();
    expect(a.prisma.vehicle.findMany.mock.calls[0][0].select).toHaveProperty('trailerType', true);
  });
});

describe('matching — vehicle queries bring attached trailers', () => {
  it('both vehicle queries include trailer types', async () => {
    const prisma: any = {
      offer: { findFirst: jest.fn().mockResolvedValue({ id: 'o', isFrigo: false }), findMany: jest.fn().mockResolvedValue([]) },
      vehicle: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: 'v' }) },
      // An offer without a pickup country → the zone of the company country.
      company: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new MatchingService(prisma);
    await service.findMatchingVehicles('o', 'comp-1');
    await service.findMatchingOffers('v', 'comp-1');
    expect(prisma.vehicle.findMany.mock.calls[0][0].include).toEqual({ trailers: { select: { vehicleType: true, trailerType: true } } });
    expect(prisma.vehicle.findFirst.mock.calls[0][0].include).toEqual({ trailers: { select: { vehicleType: true, trailerType: true } } });
  });
});

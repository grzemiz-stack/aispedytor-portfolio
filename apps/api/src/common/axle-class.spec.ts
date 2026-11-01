import {
  axleClassForCount,
  combinationAxleClass,
  plannerAxleClass,
} from './axle-class';
import { RoutePlannerService } from '../route-planner/route-planner.service';

describe('axleClassForCount — bucket boundaries', () => {
  it.each([
    [2, '2'],
    [3, '3'],
    [4, '4'],
    [5, '5+'],
    [6, '5+'],
    [7, '5+'],
  ])('%p axles → %p', (count, expected) => {
    expect(axleClassForCount(count)).toBe(expected);
  });
});

describe('plannerAxleClass — defaulted class is said out loud', () => {
  it('no axle count → 5+ and defaulted', () => {
    expect(plannerAxleClass(undefined)).toEqual({ axleClass: '5+', defaulted: true });
    expect(plannerAxleClass(null)).toEqual({ axleClass: '5+', defaulted: true });
  });

  it('a given axle count → its bucket, not defaulted — also when it is 5', () => {
    expect(plannerAxleClass(3)).toEqual({ axleClass: '3', defaulted: false });
    expect(plannerAxleClass(5)).toEqual({ axleClass: '5+', defaulted: false });
  });
});

describe('combinationAxleClass — axles of the whole combination', () => {
  const tractor = (axleCount: number | null, trailers: object[] = []) =>
    ({ vehicleCategory: 'TRUCK', axleCount, trailers });

  it('tractor without a trailer → no class (a tractor alone carries no load)', () => {
    expect(combinationAxleClass(tractor(2))).toEqual({ axleClass: null, reason: 'TRACTOR_WITHOUT_TRAILER' });
  });

  it.each([
    ['rigid', 'RIGID', 3, '3'],
    ['van', 'VAN', 2, '2'],
  ])('%s without a trailer → its own axles are the whole combination', (_l, vehicleCategory, axleCount, axleClass) => {
    expect(combinationAxleClass({ vehicleCategory, axleCount })).toEqual({ axleClass, axleCount });
  });

  it('rigid 3 + drawbar trailer 2 → 5 axles, class 5+', () => {
    expect(
      combinationAxleClass({ vehicleCategory: 'RIGID', axleCount: 3, trailers: [{ vehicleCategory: 'TRAILER', axleCount: 2 }] }),
    ).toEqual({ axleClass: '5+', axleCount: 5 });
  });

  it('rigid + drawbar trailer → the sum', () => {
    expect(
      combinationAxleClass({ vehicleCategory: 'VAN', axleCount: 2, trailers: [{ vehicleCategory: 'TRAILER', axleCount: 2 }] }),
    ).toEqual({ axleClass: '4', axleCount: 4 });
  });

  it('tractor 2 + semi-trailer 3 → 5 axles, class 5+', () => {
    expect(combinationAxleClass(tractor(2, [{ vehicleCategory: 'SEMI_TRAILER', axleCount: 3 }])))
      .toEqual({ axleClass: '5+', axleCount: 5 });
  });

  it.each([
    ['on the tractor', tractor(null, [{ vehicleCategory: 'SEMI_TRAILER', axleCount: 3 }])],
    ['on the trailer', tractor(2, [{ vehicleCategory: 'SEMI_TRAILER', axleCount: null }])],
    ['on a van', { vehicleCategory: 'VAN', axleCount: null }],
  ])('axle count missing %s → no class', (_label, vehicle) => {
    expect(combinationAxleClass(vehicle)).toEqual({ axleClass: null, reason: 'AXLE_COUNT_MISSING' });
  });

  it.each(['SEMI_TRAILER', 'TRAILER'])('a %s record on its own is not a combination', vehicleCategory => {
    expect(combinationAxleClass({ vehicleCategory, axleCount: 3 })).toEqual({ axleClass: null, reason: 'TOWED_UNIT' });
  });

  it('no category means a tractor — without a trailer, no class', () => {
    expect(combinationAxleClass({ vehicleCategory: null, axleCount: 5 })).toEqual({ axleClass: null, reason: 'TRACTOR_WITHOUT_TRAILER' });
  });
});

describe('route planner — saves the axle class it computed the toll for', () => {
  const ROUTE = {
    distance: 300_000,
    duration: 12_000,
    polyline: '',
    sections: [],
    countries: [{ countryCode: 'DE', distanceKm: 300 }],
  };
  const DTO: any = {
    origin: { lat: 52.52, lng: 13.4 },
    destination: { lat: 53.55, lng: 10.0 },
    vehicle: { grossWeight: 40000, height: 4.0, width: 2.55, length: 16.5, hasAdr: false, euroClass: 'Euro6' },
    offerId: 'off-1',
  };

  async function saved(axleCount?: number) {
    const prisma: any = {
      offer: { findFirst: jest.fn().mockResolvedValue({ id: 'off-1' }), update: jest.fn(async () => ({})) },
      // The company cost per km (offer cost = rate × km + toll).
      company: { findUnique: async () => ({ costPerKm: 4.2, costCurrency: 'PLN' }) },
      routeCalculation: { create: jest.fn().mockResolvedValue({}), findFirst: async () => null },
    };
    const adapter: any = { calculateRoute: jest.fn().mockResolvedValue([ROUTE]) };
    // A row is saved only with a provider's toll (src/tolls) — a test fake here.
    const provider: any = { quote: async () => ({ source: 'test', items: [{ countryCode: 'DE', amount: 30, currency: 'EUR' }] }) };
    const service = new RoutePlannerService(adapter, { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() } as any, prisma, provider);
    await service.calculateRoute({ ...DTO, vehicle: { ...DTO.vehicle, axleCount } }, 'comp-1');
    return prisma.routeCalculation.create.mock.calls[0][0].data;
  }

  it('given 3 axles → class 3, not defaulted', async () => {
    expect(await saved(3)).toMatchObject({ axleClass: '3', axleClassDefaulted: false });
  });

  it('given 6 axles → class 5+, not defaulted', async () => {
    expect(await saved(6)).toMatchObject({ axleClass: '5+', axleClassDefaulted: false });
  });

  it('no axle count → class 5+, defaulted', async () => {
    expect(await saved(undefined)).toMatchObject({ axleClass: '5+', axleClassDefaulted: true });
  });
});

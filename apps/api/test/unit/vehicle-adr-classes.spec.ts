/**
 * A vehicle's ADR classes from the form (decisions §7).
 *
 * Before: the API accepted and saved `adrClasses`, matching (LTL and vehicles,
 * `common/adr.ts`) used them, but the vehicle form had no field — a vehicle
 * with the ADR certificate always had an empty list and every ADR offer with a
 * class was refused (OFFER_ADR_CLASSES_UNKNOWN).
 * Now: the form sends the class list (the same list as `ADR_CLASSES`); cleared
 * in edit — `null`, and the API stores an empty list (the column is a list,
 * no null).
 */
import 'reflect-metadata';
import { VehiclesService } from '../../src/vehicles/vehicles.service';
import { ADR_CLASSES, adrCompatibility } from '../../src/common/adr';

function setup() {
  const vehicle = { id: 'veh-1', companyId: 'comp-1', vehicleCategory: 'TRUCK', parentVehicleId: null };
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn(async () => vehicle),
      update: jest.fn(async ({ data }: any) => ({ ...vehicle, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
    },
    user: { findFirst: jest.fn(async () => null) },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { service: new VehiclesService(prisma, cache), prisma };
}

it.each([
  ['a list', ['3', '8'], ['3', '8']],
  ['null (cleared in the form)', null, []],
  ['an empty list', [], []],
])('update with %s → saved as %j', async (_n, sent, stored) => {
  const { service, prisma } = setup();
  await service.update('veh-1', 'comp-1', { adrClasses: sent } as any);
  expect(prisma.vehicle.update.mock.calls[0][0].data.adrClasses).toEqual(stored);
});

it('not in the body → untouched', async () => {
  const { service, prisma } = setup();
  await service.update('veh-1', 'comp-1', { notes: 'x' } as any);
  expect(prisma.vehicle.update.mock.calls[0][0].data).not.toHaveProperty('adrClasses');
});

it('every class the form offers is read by the matching rule as itself', () => {
  for (const c of ADR_CLASSES) {
    const check = adrCompatibility({ isAdr: true, adrClass: c }, { hasAdr: true, adrClasses: [c] });
    expect([c, check.reasons]).toEqual([c, []]);
  }
});

it('what the form saves decides matching: classes 3, 8 → an offer of class 3 passes, class 2 does not, none → unknown', () => {
  const vehicle = { hasAdr: true, adrClasses: ['3', '8'] };
  expect(adrCompatibility({ isAdr: true, adrClass: '3' }, vehicle).reasons).toEqual([]);
  expect(adrCompatibility({ isAdr: true, adrClass: '2' }, vehicle).reasons.map((r) => r.code)).toEqual(['OFFER_ADR_CLASS_NOT_ALLOWED']);
  expect(adrCompatibility({ isAdr: true, adrClass: '3' }, { hasAdr: true, adrClasses: [] }).reasons.map((r) => r.code)).toEqual(['OFFER_ADR_CLASSES_UNKNOWN']);
});

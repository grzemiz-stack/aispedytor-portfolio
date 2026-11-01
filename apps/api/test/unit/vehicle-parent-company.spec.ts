/**
 * A parent vehicle only from the same company.
 *
 * `parentVehicleId` must not be saved unchecked: knowing the id of another
 * company's vehicle, one could attach an own semi-trailer to it — and then see
 * it on that vehicle's card. The parent is looked up only in the caller's company.
 */
import { BadRequestException } from '@nestjs/common';
import { VehiclesService } from '../../src/vehicles/vehicles.service';

function makeService(vehicles: Array<{ id: string; companyId: string; vehicleCategory: string }>) {
  const prisma: any = {
    vehicle: {
      // The fake filters like the database: by id AND by the company in the condition.
      findFirst: jest.fn(async ({ where }: any) =>
        vehicles.find(v => v.id === where.id && (where.companyId === undefined || v.companyId === where.companyId)) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'veh-1', ...data })),
    },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { service: new VehiclesService(prisma, cache), prisma };
}

const FLEET = [
  { id: 'veh-1', companyId: 'comp-1', vehicleCategory: 'SEMI_TRAILER' },
  { id: 'own-tractor', companyId: 'comp-1', vehicleCategory: 'TRUCK' },
  { id: 'foreign-tractor', companyId: 'comp-2', vehicleCategory: 'TRUCK' },
];

/** A semi-trailer — the only thing that may be attached to a tractor (attaching rule). */
const SEMI = { plateNumber: 'N', vehicleType: 'TRUCK', vehicleCategory: 'SEMI_TRAILER' };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as any).code;
  }
  throw new Error('expected a 400');
}

describe('parentVehicleId — only a vehicle of the same company', () => {
  it('create under a vehicle of another company → 400, nothing saved', async () => {
    const { service, prisma } = makeService(FLEET);
    expect(await codeOf(service.create('comp-1', { ...SEMI, parentVehicleId: 'foreign-tractor' } as any)))
      .toBe('VEHICLE_ATTACH_PARENT_NOT_FOUND');
    expect(prisma.vehicle.create).not.toHaveBeenCalled();
  });

  it('update under a vehicle of another company → 400, nothing saved', async () => {
    const { service, prisma } = makeService(FLEET);
    expect(await codeOf(service.update('veh-1', 'comp-1', { parentVehicleId: 'foreign-tractor' } as any)))
      .toBe('VEHICLE_ATTACH_PARENT_NOT_FOUND');
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('the lookup is scoped to the caller’s company', async () => {
    const { service, prisma } = makeService(FLEET);
    await service.create('comp-1', { ...SEMI, parentVehicleId: 'own-tractor' } as any);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toEqual({ id: 'own-tractor', companyId: 'comp-1' });
  });

  it('under an own vehicle → saved', async () => {
    const { service, prisma } = makeService(FLEET);
    await service.create('comp-1', { ...SEMI, parentVehicleId: 'own-tractor' } as any);
    expect(prisma.vehicle.create).toHaveBeenCalled();
  });

  it('under itself → 400', async () => {
    const { service } = makeService(FLEET);
    expect(await codeOf(service.update('veh-1', 'comp-1', { parentVehicleId: 'veh-1' } as any)))
      .toBe('VEHICLE_ATTACH_PARENT_NOT_FOUND');
  });

  it('detaching (empty parent) and saving without a parent need no lookup', async () => {
    const { service, prisma } = makeService(FLEET);
    await service.update('veh-1', 'comp-1', { parentVehicleId: '' } as any);
    await service.create('comp-1', { plateNumber: 'N', vehicleType: 'TRUCK' } as any);
    expect(prisma.vehicle.update).toHaveBeenCalled();
    expect(prisma.vehicle.create).toHaveBeenCalled();
  });
});

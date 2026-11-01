/**
 * Attaching semi-trailers and trailers — the rule in one place
 * (common/vehicle-category.ts), checked by the service on save.
 *
 * Code = English meaning (docs/decisions.md §7): SEMI_TRAILER = semi-trailer
 * (under a tractor), TRAILER = drawbar trailer (under a rigid or a van). The
 * test catches the codes being swapped: the semi-trailers from the seed data
 * sit under tractors, and a drawbar trailer under a tractor is rejected. The
 * parent must be in the same company — vehicle-parent-company.spec.ts.
 */
import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_PARENTS,
  VEHICLE_CATEGORIES,
  attachmentProblem,
  canHaveAttachments,
} from '../../src/common/vehicle-category';
import { VehiclesService } from '../../src/vehicles/vehicles.service';
import { extraSeedVehicles } from '../../prisma/seed-vehicles';

describe('attachmentProblem — every pair', () => {
  const ALLOWED = new Set(['SEMI_TRAILER>TRUCK', 'TRAILER>RIGID', 'TRAILER>VAN']);
  const pairs = ['SEMI_TRAILER', 'TRAILER'].flatMap(child => VEHICLE_CATEGORIES.map(parent => [child, parent]));

  it.each(pairs)('%s under %s', (child, parent) => {
    const problem = attachmentProblem(child, parent);
    if (ALLOWED.has(`${child}>${parent}`)) {
      expect(problem).toBeNull();
    } else {
      expect(problem).toEqual({
        code: 'VEHICLE_ATTACH_WRONG_PARENT',
        params: { childCategory: child, parentCategory: parent, allowedParents: ALLOWED_PARENTS[child as 'TRAILER'].join(', ') },
      });
    }
  });

  it.each(['TRUCK', 'RIGID', 'VAN'])('%s is not a towed unit — cannot be attached at all', child => {
    expect(attachmentProblem(child, 'TRUCK')).toEqual({ code: 'VEHICLE_ATTACH_NOT_TOWED', params: { childCategory: child } });
  });

  it('only a tractor, a rigid and a van can have attachments', () => {
    expect(VEHICLE_CATEGORIES.filter(canHaveAttachments)).toEqual(['TRUCK', 'RIGID', 'VAN']);
  });
});

describe('the codes are not reversed', () => {
  it('seed: every tractor carries a SEMI_TRAILER, and that pair is allowed', () => {
    const seed = extraSeedVehicles('d0', 'd1');
    const attached = seed.filter(v => v.parentVehicleId);
    expect(attached.length).toBeGreaterThan(0);
    for (const child of attached) {
      const parent = seed.find(p => p.id === child.parentVehicleId)!;
      expect([child.vehicleCategory, parent.vehicleCategory]).toEqual(['SEMI_TRAILER', 'TRUCK']);
      expect(attachmentProblem(child.vehicleCategory, parent.vehicleCategory)).toBeNull();
    }
  });

  it('a TRAILER (drawbar trailer) under a tractor is rejected', () => {
    expect(attachmentProblem('TRAILER', 'TRUCK')?.code).toBe('VEHICLE_ATTACH_WRONG_PARENT');
  });
});

describe('VehiclesService — the rule on save', () => {
  function makeService(parent: { vehicleCategory: string } | null, current?: object) {
    const prisma: any = {
      vehicle: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 'veh-1' ? current ?? null : parent)),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'veh-1', ...data })),
      },
    };
    const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
    return { service: new VehiclesService(prisma, cache), prisma };
  }

  async function rejection(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return (e as BadRequestException).getResponse();
    }
    throw new Error('expected a 400');
  }

  it('a semi-trailer under a tractor → saved', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' });
    await service.create('comp-1', { plateNumber: 'N 1', vehicleType: 'TRUCK', vehicleCategory: 'SEMI_TRAILER', parentVehicleId: 'p' } as any);
    expect(prisma.vehicle.create).toHaveBeenCalled();
  });

  it('a drawbar trailer under a tractor → 400 with the message code, nothing saved', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' });
    const body: any = await rejection(
      service.create('comp-1', { plateNumber: 'P 1', vehicleType: 'TRUCK', vehicleCategory: 'TRAILER', parentVehicleId: 'p' } as any),
    );
    expect(body).toMatchObject({ statusCode: 400, code: 'VEHICLE_ATTACH_WRONG_PARENT', params: { parentCategory: 'TRUCK' } });
    expect(prisma.vehicle.create).not.toHaveBeenCalled();
  });

  it('no category means a tractor — which cannot be attached', async () => {
    const { service } = makeService({ vehicleCategory: 'TRUCK' });
    const body: any = await rejection(service.create('comp-1', { plateNumber: 'X', vehicleType: 'TRUCK', parentVehicleId: 'p' } as any));
    expect(body.code).toBe('VEHICLE_ATTACH_NOT_TOWED');
  });

  it('changing the category of an attached record re-checks the pair', async () => {
    const current = { id: 'veh-1', companyId: 'comp-1', vehicleCategory: 'SEMI_TRAILER', parentVehicleId: 'p' };
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' }, current);
    const body: any = await rejection(service.update('veh-1', 'comp-1', { vehicleCategory: 'TRAILER' } as any));
    expect(body.code).toBe('VEHICLE_ATTACH_WRONG_PARENT');
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('detaching (empty parent) is always allowed', async () => {
    const current = { id: 'veh-1', companyId: 'comp-1', vehicleCategory: 'SEMI_TRAILER', parentVehicleId: 'p' };
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' }, current);
    await service.update('veh-1', 'comp-1', { parentVehicleId: '' } as any);
    expect(prisma.vehicle.update).toHaveBeenCalled();
  });

  it('parentFor=TRAILER lists only rigids and vans — the front filters with this', async () => {
    const { service, prisma } = makeService(null);
    await service.findAll('comp-1', {} as any, { parentFor: 'TRAILER' });
    expect(prisma.vehicle.findMany.mock.calls[0][0].where.vehicleCategory).toEqual({ in: ['RIGID', 'VAN'] });
  });

  it('parentFor=SEMI_TRAILER lists only tractors', async () => {
    const { service, prisma } = makeService(null);
    await service.findAll('comp-1', {} as any, { parentFor: 'SEMI_TRAILER' });
    expect(prisma.vehicle.findMany.mock.calls[0][0].where.vehicleCategory).toEqual({ in: ['TRUCK'] });
  });
});

describe('VehiclesService — changing the category of a parent with attached units', () => {
  function makeService(current: { vehicleCategory: string }, attached: Array<{ plateNumber: string; vehicleCategory: string }>) {
    const prisma: any = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({ id: 'parent-1', companyId: 'comp-1', parentVehicleId: null, ...current }),
        findMany: jest.fn().mockResolvedValue(attached),
        update: jest.fn(async ({ data }: any) => ({ id: 'parent-1', ...data })),
      },
    };
    const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
    return { service: new VehiclesService(prisma, cache), prisma };
  }

  it('tractor with a semi-trailer → van: rejected, the semi-trailer would be under a van', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' }, [{ plateNumber: 'PO 1N', vehicleCategory: 'SEMI_TRAILER' }]);
    let body: any;
    try {
      await service.update('parent-1', 'comp-1', { vehicleCategory: 'VAN' } as any);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      body = (e as BadRequestException).getResponse();
    }
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'VEHICLE_CATEGORY_BREAKS_ATTACHMENT',
      params: { parentCategory: 'VAN', childCategory: 'SEMI_TRAILER', childPlate: 'PO 1N', allowedParents: 'TRUCK' },
    });
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual({ parentVehicleId: 'parent-1', companyId: 'comp-1' });
  });

  it('rigid with a drawbar trailer → van: accepted, a drawbar trailer may be under a van', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'RIGID' }, [{ plateNumber: 'PO 2P', vehicleCategory: 'TRAILER' }]);
    await service.update('parent-1', 'comp-1', { vehicleCategory: 'VAN' } as any);
    expect(prisma.vehicle.update).toHaveBeenCalled();
  });

  it('no attached units → any category change is accepted', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' }, []);
    await service.update('parent-1', 'comp-1', { vehicleCategory: 'RIGID' } as any);
    expect(prisma.vehicle.update).toHaveBeenCalled();
  });

  it('category unchanged → attached units are not even looked up', async () => {
    const { service, prisma } = makeService({ vehicleCategory: 'TRUCK' }, [{ plateNumber: 'X', vehicleCategory: 'SEMI_TRAILER' }]);
    await service.update('parent-1', 'comp-1', { vehicleCategory: 'TRUCK', brand: 'Volvo' } as any);
    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
    expect(prisma.vehicle.update).toHaveBeenCalled();
  });
});

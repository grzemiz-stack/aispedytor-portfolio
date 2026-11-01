/**
 * PATCH /vehicles/:id saves what the DTO accepts: dimensions (null clears
 * one), ADR classes and the dispatcher (checked like on create — same company
 * only).
 *
 * The "every field" test guards the whole class of bug: every update-DTO
 * field is saved — no exceptions. `currentLat`/`currentLng` are not in the
 * DTO (nothing read or wrote the vehicle position).
 */import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMetadataStorage } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { VehiclesService } from '../../src/vehicles/vehicles.service';
import { UpdateVehicleDto } from '../../src/vehicles/dto/update-vehicle.dto';

function setup(users: Array<{ id: string; companyId: string }> = [{ id: 'disp-1', companyId: 'comp-1' }]) {
  const vehicle = { id: 'veh-1', companyId: 'comp-1', vehicleCategory: 'TRUCK', parentVehicleId: null };
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === vehicle.id && where.companyId === vehicle.companyId ? vehicle : null)),
      update: jest.fn(async ({ data }: any) => ({ ...vehicle, ...data })),
    },
    user: {
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id && u.companyId === where.companyId) ?? null),
    },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { service: new VehiclesService(prisma, cache), prisma };
}

const saved = (prisma: any) => prisma.vehicle.update.mock.calls[0][0].data;

describe('VehiclesService.update — fields that used to be dropped', () => {
  it('dimensions are saved', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { lengthM: 13.6, heightM: 2.7, widthM: 2.48 } as any);
    expect(saved(prisma)).toEqual({ lengthM: 13.6, heightM: 2.7, widthM: 2.48 });
  });

  it('a dimension of 0 is a value, not skipped', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { heightM: 0 } as any);
    expect(saved(prisma)).toEqual({ heightM: 0 });
  });

  it('ADR classes are saved, also an empty list', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { adrClasses: ['3', '8'] } as any);
    expect(saved(prisma)).toEqual({ adrClasses: ['3', '8'] });

    const second = setup();
    await second.service.update('veh-1', 'comp-1', { adrClasses: [] } as any);
    expect(saved(second.prisma)).toEqual({ adrClasses: [] });
  });

  it('a dispatcher of the same company is saved; an empty value clears it', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { dispatcherId: 'disp-1' } as any);
    expect(saved(prisma)).toEqual({ dispatcherId: 'disp-1' });

    const second = setup();
    await second.service.update('veh-1', 'comp-1', { dispatcherId: '' } as any);
    expect(saved(second.prisma)).toEqual({ dispatcherId: null });
  });

  it('a dispatcher of another company → 400 VEHICLE_DISPATCHER_NOT_FOUND, nothing saved', async () => {
    const { service, prisma } = setup([{ id: 'disp-9', companyId: 'comp-9' }]);
    const err = await service.update('veh-1', 'comp-1', { dispatcherId: 'disp-9' } as any).catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().code).toBe('VEHICLE_DISPATCHER_NOT_FOUND');
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('null clears a dimension; a missing field is no change', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { lengthM: null, widthM: 2.48 } as any);
    expect(saved(prisma)).toEqual({ lengthM: null, widthM: 2.48 });
  });

  it('null for a dimension passes the same ValidationPipe as main.ts', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const body = await pipe.transform({ lengthM: null, heightM: null, widthM: null }, { type: 'body', metatype: UpdateVehicleDto, data: '' });
    expect(body).toEqual({ lengthM: null, heightM: null, widthM: null });
  });

  it('fields not sent are not touched', async () => {
    const { service, prisma } = setup();
    await service.update('veh-1', 'comp-1', { notes: 'x' } as any);
    expect(saved(prisma)).toEqual({ notes: 'x' });
  });
});

it('every field of UpdateVehicleDto is written by update — no exceptions', () => {
  const fields = [...new Set(
    getMetadataStorage().getTargetValidationMetadatas(UpdateVehicleDto, '', true, false).map((m) => m.propertyName),
  )];
  const src = readFileSync(resolve(__dirname, '../../src/vehicles/vehicles.service.ts'), 'utf8');
  const update = src.slice(src.indexOf('async update('), src.indexOf('async delete('));

  expect(fields.length).toBeGreaterThan(30);
  expect(fields.filter((f) => !update.includes(`dto.${f}`))).toEqual([]);
});

it('currentLat / currentLng are not accepted — 400 under forbidNonWhitelisted', async () => {
  // Nothing reads or writes the vehicle position; the fields were accepted and dropped.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  for (const body of [{ currentLat: 52.4 }, { currentLng: 16.9 }]) {
    const err = await pipe.transform(body, { type: 'body', metatype: UpdateVehicleDto, data: '' }).catch((e) => e);
    expect(err.getStatus()).toBe(400);
  }
});

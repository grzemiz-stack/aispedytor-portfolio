/**
 * A vehicle's ADR classes on a real Postgres (decisions §7).
 *
 * The edit form sends a cleared field as `null`. The `adr_classes` column is a
 * list without null — Prisma itself refuses `null`, so the service stores an
 * empty list. The test shows both: the refusal and the service's save.
 */
import { PrismaClient } from '@prisma/client';
import { VehiclesService } from '../../src/vehicles/vehicles.service';

const prisma = new PrismaClient();
const service = new VehiclesService(prisma as any, { get: () => undefined, set: () => undefined, deleteByPrefix: () => undefined } as any);
let companyId: string;
let vehicleId: string;

beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ select: { id: true } })).id;
  vehicleId = (await prisma.vehicle.create({
    data: { companyId, plateNumber: 'ADRTEST 1', vehicleType: 'TRUCK', hasAdr: true, adrClasses: ['3', '8'] } as any,
  })).id;
});
afterAll(async () => {
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await prisma.$disconnect();
});

it('the list column refuses null (the reason the service stores an empty list)', async () => {
  await expect(prisma.vehicle.update({ where: { id: vehicleId }, data: { adrClasses: null as any } })).rejects.toThrow();
});

it('the form\'s classes are saved; null (cleared) → an empty list', async () => {
  await service.update(vehicleId, companyId, { adrClasses: ['2', '4.1'] } as any);
  expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).adrClasses).toEqual(['2', '4.1']);
  await service.update(vehicleId, companyId, { adrClasses: null } as any);
  expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).adrClasses).toEqual([]);
});

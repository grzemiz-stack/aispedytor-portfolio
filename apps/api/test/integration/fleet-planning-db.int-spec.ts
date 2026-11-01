/**
 * Fleet planning tables on a real PostgreSQL (run by tools/demo-test.sh after
 * `migrate deploy`). The CHECK constraints hold physical bounds only; this
 * test proves each one rejects what it should and a valid row passes.
 * Creates its own company and removes it (cascade) at the end.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let companyId: string;
let truckId: string;
let driverId: string;

const validStatus = () => ({
  driverId,
  asOf: new Date('2026-10-05T06:00:00Z'),
  weeklyRestEndedAt: new Date('2026-10-05T06:00:00Z'),
  weeklyRestType: 'REGULAR' as const,
  drivingThisWeekMinutes: 0,
  drivingLastWeekMinutes: 2400,
  lastHomeRestEndedAt: new Date('2026-10-05T06:00:00Z'),
});

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: 'Fleet planning DB test' } });
  companyId = company.id;
  const truck = await prisma.vehicle.create({
    data: { companyId, plateNumber: 'FP-DB-1', vehicleType: 'TRUCK', vehicleCategory: 'TRUCK' },
  });
  truckId = truck.id;
  driverId = (await prisma.driver.create({ data: { companyId, firstName: 'Test', lastName: 'Driver' } })).id;
});

afterAll(async () => {
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

it('accepts a valid status; omitted compensation is unknown (NULL), not 0', async () => {
  await expect(prisma.driverStatus.create({ data: validStatus() })).resolves.toMatchObject({ compensationOwedMinutes: null });
});

it('accepts unknown weekly rest type, last rest at home and compensation (NULL)', async () => {
  const row = await prisma.driverStatus.create({ data: { ...validStatus(), weeklyRestType: null, lastHomeRestEndedAt: null, compensationOwedMinutes: null } });
  expect([row.weeklyRestType, row.lastHomeRestEndedAt, row.compensationOwedMinutes]).toEqual([null, null, null]);
});

it('accepts onDuty unknown (NULL), false, and true with the daily rest end', async () => {
  const unknown = await prisma.driverStatus.create({ data: validStatus() });
  const resting = await prisma.driverStatus.create({ data: { ...validStatus(), onDuty: false } });
  const onDuty = await prisma.driverStatus.create({ data: { ...validStatus(), onDuty: true, dailyRestEndedAt: new Date('2026-10-05T07:00:00Z'), drivingSinceDailyRestMinutes: 0, drivingSinceBreakMinutes: 0, workSinceBreakMinutes: 0 } });
  expect([unknown.onDuty, resting.onDuty, onDuty.onDuty]).toEqual([null, false, true]);
});

it('accepts nothing owed: 0 without a deadline', async () => {
  await expect(prisma.driverStatus.create({ data: { ...validStatus(), compensationOwedMinutes: 0 } })).resolves.toMatchObject({ compensationOwedMinutes: 0 });
});

it.each([
  ['driving this week above one week', { drivingThisWeekMinutes: 10081 }, 'driver_statuses_minutes_check'],
  ['negative driving last week', { drivingLastWeekMinutes: -1 }, 'driver_statuses_minutes_check'],
  ['compensation above two full reductions', { compensationOwedMinutes: 2521, compensationDueBy: new Date() }, 'driver_statuses_minutes_check'],
  ['driving since break above a day', { drivingSinceBreakMinutes: 1441 }, 'driver_statuses_minutes_check'],
  ['eight extended days', { extendedDrivingDaysUsed: 8 }, 'driver_statuses_counters_check'],
  ['negative reduced rests', { reducedDailyRestsUsed: -1 }, 'driver_statuses_counters_check'],
  ['compensation owed without a deadline', { compensationOwedMinutes: 60 }, 'driver_statuses_compensation_check'],
  ['a deadline with unknown compensation', { compensationDueBy: new Date() }, 'driver_statuses_compensation_check'],
  ['the daily rest end with onDuty unknown', { dailyRestEndedAt: new Date(), drivingSinceDailyRestMinutes: 0, drivingSinceBreakMinutes: 0, workSinceBreakMinutes: 0 }, 'driver_statuses_on_duty_check'],
  ['onDuty true without the daily rest end', { onDuty: true }, 'driver_statuses_on_duty_check'],
  ['unavailable without a reason', { unavailableUntil: new Date() }, 'driver_statuses_unavailable_check'],
  ['a reason without an end', { unavailableReason: 'LEAVE' as const }, 'driver_statuses_unavailable_check'],
])('rejects %s', async (_name, change, constraint) => {
  await expect(prisma.driverStatus.create({ data: { ...validStatus(), ...change } })).rejects.toThrow(constraint);
});

it('one driver per vehicle', async () => {
  await prisma.driver.update({ where: { id: driverId }, data: { vehicleId: truckId } });
  await expect(
    prisma.driver.create({ data: { companyId, firstName: 'Second', lastName: 'Driver', vehicleId: truckId } }),
  ).rejects.toThrow(/Unique constraint/);
});

it('deleting the vehicle unassigns the driver; deleting the driver removes the statuses', async () => {
  await prisma.vehicle.delete({ where: { id: truckId } });
  expect((await prisma.driver.findUniqueOrThrow({ where: { id: driverId } })).vehicleId).toBeNull();
  await prisma.driver.delete({ where: { id: driverId } });
  expect(await prisma.driverStatus.count({ where: { driverId } })).toBe(0);
});

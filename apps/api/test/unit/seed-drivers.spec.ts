/**
 * Demo drivers (prisma/seed-drivers.ts): valid statuses that tell the
 * intended story to the rules engine, on any day the seed runs.
 */
import { ValidationPipe } from '@nestjs/common';
import { SEED_DRIVERS, seedDriverStatuses, weekStartOf } from '../../prisma/seed-drivers';
import { extraSeedVehicles } from '../../prisma/seed-vehicles';
import { isTowedCategory } from '../../src/common/vehicle-category';
import { toSnapshot } from '../../src/fleet-planning/activity/manual-driver-activity.provider';
import { CreateDriverStatusDto } from '../../src/fleet-planning/dto/create-driver-status.dto';
import { statusProblem } from '../../src/fleet-planning/drivers.service';
import { driverAvailability } from '../../src/fleet-planning/rules/availability';
import { endOfWeekAfter } from '../../src/fleet-planning/rules/fixed-week';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const NOW = new Date('2026-10-07T10:00:00Z');

/** A seed row as the API body it could have come from. */
function asDto(row: ReturnType<typeof seedDriverStatuses>[number]) {
  const { id: _id, driverId: _d, recentWeeklyRests, unavailableReason, unavailableUntil, compensationDueBy, ...rest } = row;
  const iso = (v: Date | null) => (v ? v.toISOString() : undefined);
  return {
    ...rest,
    asOf: rest.asOf.toISOString(),
    weeklyRestEndedAt: rest.weeklyRestEndedAt.toISOString(),
    lastHomeRestEndedAt: rest.lastHomeRestEndedAt.toISOString(),
    ...(recentWeeklyRests ? { recentWeeklyRests } : {}),
    ...(compensationDueBy ? { compensationDueBy: iso(compensationDueBy) } : {}),
    ...(unavailableUntil ? { unavailableUntil: iso(unavailableUntil), unavailableReason: unavailableReason! } : {}),
  };
}
const availability = (row: ReturnType<typeof seedDriverStatuses>[number], at = NOW) =>
  driverAvailability(toSnapshot({ ...row, enteredById: null, createdAt: at } as never), at);

it('anchored to Monday 00:00 UTC of the seed week', () => {
  expect(weekStartOf(NOW).toISOString()).toBe('2026-10-05T00:00:00.000Z');
});

it('assigned vehicles are seed power units, each to one driver', () => {
  const vehicles = extraSeedVehicles('d0', 'd1');
  const assigned = SEED_DRIVERS.map((d) => d.vehicleId).filter(Boolean);
  expect(new Set(assigned).size).toBe(assigned.length);
  for (const id of assigned) {
    const v = vehicles.find((x) => x.id === id);
    expect([id, v != null && !isTowedCategory(v.vehicleCategory)]).toEqual([id, true]);
  }
});

it.each(seedDriverStatuses(NOW).map((r) => [r.driverId, r] as const))('%s: a status the API would accept', async (_id, row) => {
  const dto = asDto(row);
  await expect(pipe.transform(dto, { type: 'body', metatype: CreateDriverStatusDto, data: '' })).resolves.toBeDefined();
  expect(statusProblem(dto as CreateDriverStatusDto)).toBeNull();
});

it('every driver with a status, every driver id known; driver 4 has none', () => {
  const ids = seedDriverStatuses(NOW).map((r) => r.driverId);
  expect([ids, SEED_DRIVERS.map((d) => d.id)]).toEqual([['seed-driver-1', 'seed-driver-2', 'seed-driver-3'], ['seed-driver-1', 'seed-driver-2', 'seed-driver-3', 'seed-driver-4']]);
});

describe('the story each one tells (Wednesday 10:00)', () => {
  const [one, two, three] = seedDriverStatuses(NOW);

  it('1: can depart now, a full day, no messages', () => {
    const a = availability(one);
    expect([a.canDepartFrom.toISOString(), a.drivingLeft.total, a.violations, a.warnings, a.notices]).toEqual(['2026-10-07T10:00:00.000Z', 540, [], [], []]);
  });

  it('2: the next weekly rest must be regular, 21 h of compensation owed', () => {
    const a = availability(two);
    expect([a.nextWeeklyRestMayBeReduced, a.compensationOwed.map((c) => c.minutes), a.violations]).toEqual([false, [1260], []]);
    // The deadline the engine itself would give: end of the third week after the reduction.
    expect(two.compensationDueBy?.getTime()).toBe(endOfWeekAfter(two.weeklyRestEndedAt.getTime(), 3));
  });

  it('3: on leave until next Monday 06:00', () => {
    expect(availability(three).canDepartFrom.toISOString()).toBe('2026-10-12T06:00:00.000Z');
  });
});

it.each(['2026-10-05T00:30:00Z', '2026-10-08T23:59:00Z', '2026-10-11T23:30:00Z'])('seeded at %s: no violations, nothing stale', (iso) => {
  const now = new Date(iso);
  for (const row of seedDriverStatuses(now)) {
    const a = availability(row, now);
    expect([row.driverId, a.violations, a.notices.filter((n) => n.code === 'DRIVER_STATUS_STALE')]).toEqual([row.driverId, [], []]);
  }
});

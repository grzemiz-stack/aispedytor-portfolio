/**
 * The default provider against the contract, with Prisma replaced by an
 * in-memory stub (the same contract runs on a real PostgreSQL in
 * test/integration/fleet-planning-db.int-spec.ts).
 */
import type { DriverStatus } from '@prisma/client';
import { runDriverActivityProviderContract } from './driver-activity-provider.contract';
import { ManualDriverActivityProvider } from '../../src/fleet-planning/activity/manual-driver-activity.provider';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { d } from '../fixtures/driver-status';

const row = (over: Partial<DriverStatus>): DriverStatus => ({
  id: 's1', driverId: 'driver-1', enteredById: null, createdAt: d('2026-10-07T08:00:00Z'),
  asOf: d('2026-10-07T08:00:00Z'), weeklyRestEndedAt: d('2026-10-05T06:00:00Z'), weeklyRestType: 'REGULAR',
  weeklyRestAbroad: false, weeklyRestAtHome: true,
  recentWeeklyRests: [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00.000Z', abroad: false }],
  drivingThisWeekMinutes: 900, drivingLastWeekMinutes: 2400, extendedDrivingDaysUsed: 1, reducedDailyRestsUsed: 0,
  compensationOwedMinutes: 0, compensationDueBy: null, lastHomeRestEndedAt: d('2026-10-05T06:00:00Z'),
  driverChoseToStayAway: false, onDuty: false, dailyRestEndedAt: null, drivingSinceDailyRestMinutes: null,
  drivingSinceBreakMinutes: null, workSinceBreakMinutes: null, unavailableUntil: null, unavailableReason: null,
  ...over,
});

/** findFirst({ where: { driverId }, orderBy: { createdAt: 'desc' } }) over a list. */
function prismaWith(rows: DriverStatus[]): PrismaService {
  return {
    driverStatus: {
      findFirst: async ({ where }: { where: { driverId: string } }) =>
        rows.filter((r) => r.driverId === where.driverId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
    },
  } as unknown as PrismaService;
}

runDriverActivityProviderContract('ManualDriverActivityProvider (stubbed Prisma)', {
  make: async () => ({ provider: new ManualDriverActivityProvider(prismaWith([row({})])), knownDriverId: 'driver-1' }),
});

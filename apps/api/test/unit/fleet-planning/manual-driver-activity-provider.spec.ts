/**
 * The manual provider: the newest status wins, the row maps to the engine's
 * snapshot, and a malformed list of recent weekly rests reads as unknown.
 */
import type { DriverStatus } from '@prisma/client';
import { ManualDriverActivityProvider, parseRecentWeeklyRests, toSnapshot } from '../../../src/fleet-planning/activity/manual-driver-activity.provider';
import type { PrismaService } from '../../../src/prisma/prisma.service';

const at = (iso: string) => new Date(iso);

it('the newest status (by createdAt) is the current one', async () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const provider = new ManualDriverActivityProvider({ driverStatus: { findFirst } } as unknown as PrismaService);
  await provider.currentStatus('driver-1');
  expect(findFirst).toHaveBeenCalledWith({ where: { driverId: 'driver-1' }, orderBy: { createdAt: 'desc' } });
});

it('history: always empty, no coverage (a manual status is not an activity log)', async () => {
  const provider = new ManualDriverActivityProvider({} as PrismaService);
  expect(await provider.history()).toEqual({ source: 'manual', activities: [], coveredFrom: null, coveredTo: null });
});

it('the row maps field by field; unavailableReason is not part of the engine state', () => {
  const row = {
    asOf: at('2026-10-07T08:00:00Z'), weeklyRestEndedAt: at('2026-10-05T06:00:00Z'), weeklyRestType: 'REDUCED',
    weeklyRestAbroad: true, weeklyRestAtHome: false, recentWeeklyRests: null, drivingThisWeekMinutes: 1, drivingLastWeekMinutes: 2,
    extendedDrivingDaysUsed: null, reducedDailyRestsUsed: 3, compensationOwedMinutes: 4, compensationDueBy: at('2026-10-20T00:00:00Z'),
    lastHomeRestEndedAt: at('2026-09-20T06:00:00Z'), driverChoseToStayAway: true, dailyRestEndedAt: at('2026-10-07T05:00:00Z'),
    drivingSinceDailyRestMinutes: 5, drivingSinceBreakMinutes: 6, workSinceBreakMinutes: 7, unavailableUntil: at('2026-10-09T00:00:00Z'),
    unavailableReason: 'LEAVE',
  } as unknown as DriverStatus;
  const s = toSnapshot(row);
  expect([s.weeklyRestType, s.weeklyRestAbroad, s.extendedDrivingDaysUsed, s.reducedDailyRestsUsed, s.compensationOwedMinutes, s.driverChoseToStayAway, s.workSinceBreakMinutes, s.unavailableUntil?.toISOString()])
    .toEqual(['REDUCED', true, null, 3, 4, true, 7, '2026-10-09T00:00:00.000Z']);
  expect('unavailableReason' in s).toBe(false);
});

describe('recent weekly rests from the JSON column', () => {
  it('a valid list', () => {
    expect(parseRecentWeeklyRests([{ type: 'REDUCED', endedAt: '2026-10-05T06:00:00.000Z', abroad: true }]))
      .toEqual([{ type: 'REDUCED', endedAt: at('2026-10-05T06:00:00.000Z'), abroad: true }]);
  });

  it.each([
    ['null', null],
    ['empty', []],
    ['four entries', Array(4).fill({ type: 'REGULAR', endedAt: '2026-10-05T06:00:00.000Z', abroad: false })],
    ['unknown type', [{ type: 'LONG', endedAt: '2026-10-05T06:00:00.000Z', abroad: false }]],
    ['bad date', [{ type: 'REGULAR', endedAt: 'yesterday', abroad: false }]],
    ['abroad not a boolean', [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00.000Z', abroad: 'no' }]],
  ])('%s → unknown (null)', (_name, value) => {
    expect(parseRecentWeeklyRests(value)).toBeNull();
  });
});

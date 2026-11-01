/**
 * A driver status for fleet planning tests: Wednesday 7 Oct 2026, after a
 * regular weekly rest at home that ended on Monday 06:00 UTC. Override what
 * the test is about.
 */
import type { DriverStatusSnapshot } from '../../src/fleet-planning/rules/driver-state';

export const d = (iso: string) => new Date(iso);
export const t = (iso: string) => d(iso).getTime();

export const status = (over: Partial<DriverStatusSnapshot> = {}): DriverStatusSnapshot => ({
  asOf: d('2026-10-07T08:00:00Z'),
  weeklyRestEndedAt: d('2026-10-05T06:00:00Z'),
  weeklyRestType: 'REGULAR',
  weeklyRestAbroad: false,
  weeklyRestAtHome: true,
  recentWeeklyRests: null,
  drivingThisWeekMinutes: 900,
  drivingLastWeekMinutes: 2400,
  extendedDrivingDaysUsed: 1,
  reducedDailyRestsUsed: 1,
  compensationOwedMinutes: 0,
  compensationDueBy: null,
  lastHomeRestEndedAt: d('2026-10-05T06:00:00Z'),
  driverChoseToStayAway: false,
  onDuty: false,
  dailyRestEndedAt: null,
  drivingSinceDailyRestMinutes: null,
  drivingSinceBreakMinutes: null,
  workSinceBreakMinutes: null,
  unavailableUntil: null,
  ...over,
});

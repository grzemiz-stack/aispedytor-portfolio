/**
 * Driver availability (SPEC §7 stage 1): can depart from…, driving left…,
 * must be home by….
 *
 * "Can depart" is where the planner would put the first minute of driving
 * (after a running weekly rest, an unavailability, or a rest the driver
 * still owes). The counters are read at that moment.
 */
import type { PlanMessage } from '../../common/plan-messages';
import { checkTimeline } from './check-timeline';
import { engineStart, type DriverStatusSnapshot } from './driver-state';
import { LIMITS } from './limits';
import { weekIndex } from './fixed-week';
import { planTimeline, type PlanStrategy } from './plan-timeline';

export interface DriverAvailability {
  /** The moment asked about. */
  at: Date;
  canDepartFrom: Date;
  /** Minutes of driving left at `canDepartFrom`, by limit; `total` is the smallest. */
  drivingLeft: {
    untilBreak: number;
    today: number;
    /** Today with a 10-hour day, when one is still available this week; else equal to `today`. */
    todayExtended: number;
    week: number;
    fortnight: number;
    total: number;
  };
  /** Latest start of the daily rest of the duty that starts at `canDepartFrom` (standard 11 h rest). */
  dailyRestLatestStart: Date;
  weeklyRestLatestStart: Date;
  /** Whether the next weekly rest may be reduced (the last one was regular). */
  nextWeeklyRestMayBeReduced: boolean;
  compensationOwed: { minutes: number; dueBy: Date }[];
  /** Latest start of the next rest at home (art. 8(8a); a company obligation). */
  mustBeHomeBy: Date;
  violations: PlanMessage[];
  warnings: PlanMessage[];
  notices: PlanMessage[];
}

export function driverAvailability(status: DriverStatusSnapshot, at: Date, strategy: PlanStrategy = 'standard'): DriverAvailability {
  const start = engineStart(status, at.getTime());
  const plan = planTimeline(start, [{ type: 'DRIVE', minutes: 1 }], { startAt: at.getTime(), strategy });
  const firstDrive = plan.segments.find((s) => s.type === 'DRIVE')!;
  // The ledger just before that minute of driving.
  const before = checkTimeline(start, plan.segments.filter((s) => s.end <= firstDrive.start));
  const tr = before.tracker;
  const departs = firstDrive.start;
  const w = weekIndex(departs);
  const fresh = tr.dutyStart == null;
  const extendedAvailable = tr.extendedThisDuty || tr.extendedDaysInWeek(fresh ? w : tr.dutyWeek()) < LIMITS.extendedDaysPerWeek;

  const today = LIMITS.dailyDriving - tr.drivingInDuty;
  const drivingLeft = {
    untilBreak: LIMITS.continuousDriving - tr.drivingSinceBreak,
    today: Math.max(0, today),
    todayExtended: Math.max(0, extendedAvailable ? LIMITS.dailyDrivingExtended - tr.drivingInDuty : today),
    week: Math.max(0, LIMITS.weeklyDriving - tr.drivingInWeek(w)),
    fortnight: Math.max(0, LIMITS.fortnightDriving - tr.drivingInWeek(w) - tr.drivingInWeek(w - 1)),
    total: 0,
  };
  drivingLeft.total = Math.max(0, Math.min(drivingLeft.today, drivingLeft.week, drivingLeft.fortnight));

  const windowEnd = tr.dailyRestWindowEnd() ?? departs + LIMITS.dailyRestWindow * 60_000;
  return {
    at,
    canDepartFrom: new Date(departs),
    drivingLeft,
    dailyRestLatestStart: new Date(windowEnd - LIMITS.dailyRestRegular * 60_000),
    weeklyRestLatestStart: new Date(tr.weeklyRestDeadline()),
    nextWeeklyRestMayBeReduced: tr.nextWeeklyRestMayBeReduced(),
    compensationOwed: tr.compensation.map((c) => ({ minutes: c.minutes, dueBy: new Date(c.dueBy) })),
    mustBeHomeBy: new Date(tr.homeRestDeadline()),
    violations: before.violations,
    warnings: before.warnings,
    notices: before.notices,
  };
}

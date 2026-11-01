/**
 * Driver status → the state the rules engine starts from.
 *
 * A status describes the driver at `asOf`. The engine starts at
 * `origin = max(asOf, end of the last weekly rest)` and assumes nothing
 * happened between `asOf` and `origin` except that rest. The week counters
 * (`drivingThisWeek`, `drivingLastWeek`, 10-hour days) belong to the fixed
 * week of `asOf`; when `origin` is in a later week they are aged.
 *
 * Unknown values are never guessed in the driver's favour: an unknown count
 * is taken as used up, and the result says so (DRIVER_STATE_ASSUMED).
 * Driving this week and last week and the end of the last weekly rest have
 * no worst case that leaves a usable plan — they are required (DTO, DB).
 */
import { msg, type PlanMessage } from '../../common/plan-messages';
import { DAY, LIMITS } from './limits';
import { MINUTE_MS, endOfWeekAfter, weekIndex } from './fixed-week';

export type WeeklyRestKind = 'REGULAR' | 'REDUCED';

export interface WeeklyRestRecord {
  type: WeeklyRestKind;
  endedAt: Date;
  abroad: boolean;
}

/** What a DriverActivityProvider returns from `currentStatus` (manual: the DriverStatus row). */
export interface DriverStatusSnapshot {
  asOf: Date;
  weeklyRestEndedAt: Date;
  /** null = unknown: taken as REDUCED. */
  weeklyRestType: WeeklyRestKind | null;
  weeklyRestAbroad: boolean;
  weeklyRestAtHome: boolean;
  /** Up to three most recent weekly rests, newest first (the first is the rest above); null = unknown. */
  recentWeeklyRests: WeeklyRestRecord[] | null;
  drivingThisWeekMinutes: number;
  drivingLastWeekMinutes: number;
  extendedDrivingDaysUsed: number | null;
  reducedDailyRestsUsed: number | null;
  /** null = unknown: 21 h for every reduced weekly rest of known date whose deadline has not passed. */
  compensationOwedMinutes: number | null;
  compensationDueBy: Date | null;
  /** null = unknown: the rest at home is taken as due at `asOf`. */
  lastHomeRestEndedAt: Date | null;
  driverChoseToStayAway: boolean;
  /**
   * On duty at `asOf` (true), resting (false), or unknown (null — taken as on
   * duty with the day's driving, the break and work used up). With true the
   * end of the daily rest is given; a provider that gives it with null is
   * taken as on duty.
   */
  onDuty: boolean | null;
  /** Set when the driver is on duty at `asOf` (after a daily rest). */
  dailyRestEndedAt: Date | null;
  drivingSinceDailyRestMinutes: number | null;
  drivingSinceBreakMinutes: number | null;
  workSinceBreakMinutes: number | null;
  unavailableUntil: Date | null;
}

export interface WeeklyRestState {
  type: WeeklyRestKind;
  endedAt: number;
  abroad: boolean;
}

export interface CompensationOwed {
  minutes: number;
  dueBy: number;
}

/** An open duty period (since the end of the last daily or weekly rest). */
export interface ShiftState {
  dutyStart: number;
  driving: number;
  drivingSinceBreak: number;
  workSinceBreak: number;
}

export interface EngineStart {
  /** Where the engine's clock starts (epoch ms). */
  origin: number;
  /** Earliest the driver may start work: origin, or the end of an unavailability. */
  earliestStart: number;
  lastWeeklyRest: WeeklyRestState;
  /** Newest first, including `lastWeeklyRest`; null when not known. */
  recentWeeklyRests: WeeklyRestState[] | null;
  /** Driving in the fixed week of `origin` and in the week before. */
  drivingThisWeek: number;
  drivingLastWeek: number;
  extendedDaysUsed: number;
  reducedDailyRestsUsed: number;
  compensation: CompensationOwed[];
  /** null when unknown; then `homeRestDueBy` is set. */
  lastHomeRestEndedAt: number | null;
  /** Set only when the last rest at home is unknown: the deadline taken as `asOf`. */
  homeRestDueBy: number | null;
  driverChoseToStayAway: boolean;
  shift: ShiftState | null;
  messages: PlanMessage[];
}

/**
 * A status the engine cannot start from: a required value is missing
 * (`field`). The manual status never gets here (DTO, DB); a provider that
 * breaks the contract does.
 */
export class DriverStatusError extends Error {
  constructor(readonly field: string) {
    super(`Driver status incomplete: ${field}`);
    this.name = 'DriverStatusError';
  }
}

/** A status older than this at the moment of evaluation is reported as stale. */
export const STALE_AFTER_MS = 7 * DAY * MINUTE_MS;

const assumed = (field: string, value: number | string) => msg('DRIVER_STATE_ASSUMED', { field, value });

/** `now`: the moment of evaluation (epoch ms), only for the staleness check. */
export function engineStart(s: DriverStatusSnapshot, now: number): EngineStart {
  const asOf = s.asOf.getTime();
  const origin = Math.max(asOf, s.weeklyRestEndedAt.getTime());
  const messages: PlanMessage[] = [];

  // Week counters: written for the week of `asOf`, read in the week of `origin`.
  const weeksLater = weekIndex(origin) - weekIndex(asOf);
  let drivingThisWeek = s.drivingThisWeekMinutes;
  let drivingLastWeek = s.drivingLastWeekMinutes;
  let extendedDaysUsed: number;
  if (weeksLater === 0) {
    extendedDaysUsed = s.extendedDrivingDaysUsed ?? LIMITS.extendedDaysPerWeek;
    if (s.extendedDrivingDaysUsed == null) messages.push(assumed('extendedDrivingDaysUsed', extendedDaysUsed));
  } else {
    // A new fixed week: its 10-hour days start from zero.
    extendedDaysUsed = 0;
    drivingLastWeek = weeksLater === 1 ? drivingThisWeek : 0;
    drivingThisWeek = 0;
  }

  // Reduced daily rests count since the last weekly rest.
  const reducedDailyRestsUsed = s.reducedDailyRestsUsed ?? LIMITS.reducedDailyRestsBetweenWeekly;
  if (s.reducedDailyRestsUsed == null) messages.push(assumed('reducedDailyRestsUsed', reducedDailyRestsUsed));

  // Unknown type: reduced — the next weekly rest must then be regular and
  // compensation may be owed.
  const lastWeeklyRest: WeeklyRestState = {
    type: s.weeklyRestType ?? 'REDUCED',
    endedAt: s.weeklyRestEndedAt.getTime(),
    abroad: s.weeklyRestAbroad,
  };
  if (s.weeklyRestType == null) messages.push(assumed('weeklyRestType', 'REDUCED'));

  const compensation: CompensationOwed[] = [];
  if (s.compensationOwedMinutes == null) {
    // Unknown: none of the reduced weekly rests of known date was compensated.
    // Each owes the most a reduced rest can (45 h − 24 h), by the earliest
    // deadline: a reduced rest is shorter than 45 h, so it started at the
    // earliest 45 h − 1 min before its end; the deadline is the end of the
    // third week after the week it started in. A deadline
    // already passed is not assumed missed — that would report a violation
    // nobody knows happened. But the rest is dropped only once even its
    // LATEST possible deadline has passed (it started at the latest 24 h
    // before its end): between the two it is still owed, by the latest
    // deadline — not forgotten.
    const reduced = [lastWeeklyRest, ...(s.recentWeeklyRests ?? []).slice(1).map((r) => ({ type: r.type, endedAt: r.endedAt.getTime() }))]
      .filter((r) => r.type === 'REDUCED');
    for (const r of reduced) {
      const earliestStart = r.endedAt - (LIMITS.weeklyRestRegular - 1) * MINUTE_MS;
      const latestStart = r.endedAt - LIMITS.weeklyRestReduced * MINUTE_MS;
      const earliestDue = endOfWeekAfter(earliestStart, LIMITS.compensationWeeksAfter);
      const latestDue = endOfWeekAfter(latestStart, LIMITS.compensationWeeksAfter);
      const dueBy = earliestDue > origin ? earliestDue : latestDue;
      if (dueBy <= origin) continue;
      compensation.push({ minutes: LIMITS.weeklyRestRegular - LIMITS.weeklyRestReduced, dueBy });
    }
    messages.push(assumed('compensationOwedMinutes', compensation.reduce((m, c) => m + c.minutes, 0)));
  } else if (s.compensationOwedMinutes > 0) {
    // The deadline is required with an owed compensation (DB CHECK, DTO,
    // provider contract). A provider that omits it: with the last weekly rest
    // reduced and at most 21 h owed, the amount is that rest's, so it started
    // 45 h − amount before its end, and the deadline is the end of the third
    // week after the week it STARTED (art. 8(6)). Otherwise part is owed for
    // an earlier rest of unknown date — no deadline can be derived, and none
    // is made up: the status is refused (docs/decisions.md §11).
    let dueBy = s.compensationDueBy?.getTime();
    if (dueBy == null) {
      const maxOneRest = LIMITS.weeklyRestRegular - LIMITS.weeklyRestReduced;
      if (lastWeeklyRest.type !== 'REDUCED' || s.compensationOwedMinutes > maxOneRest) throw new DriverStatusError('compensationDueBy');
      const restStart = lastWeeklyRest.endedAt - (LIMITS.weeklyRestRegular - s.compensationOwedMinutes) * MINUTE_MS;
      dueBy = endOfWeekAfter(restStart, LIMITS.compensationWeeksAfter);
      messages.push(msg('DRIVER_STATE_ASSUMED', { field: 'compensationDueBy', value: new Date(dueBy).toISOString() }));
    }
    compensation.push({ minutes: s.compensationOwedMinutes, dueBy });
  }

  // Unknown last rest at home: the rest at home is taken as due at `asOf`
  // (value: that moment); the tracker reports HOME_RETURN_LATE from the start.
  const homeRestDueBy = s.lastHomeRestEndedAt == null ? asOf : null;
  if (homeRestDueBy != null) messages.push(assumed('lastHomeRestEndedAt', new Date(asOf).toISOString()));

  let shift: ShiftState | null = null;
  if (s.onDuty === false && s.dailyRestEndedAt) throw new DriverStatusError('onDuty');
  if (s.onDuty === true && !s.dailyRestEndedAt) throw new DriverStatusError('dailyRestEndedAt');
  if (s.dailyRestEndedAt) {
    const take = (field: string, value: number | null, worst: number) => {
      if (value != null) return value;
      messages.push(assumed(field, worst));
      return worst;
    };
    shift = {
      dutyStart: s.dailyRestEndedAt.getTime(),
      driving: take('drivingSinceDailyRestMinutes', s.drivingSinceDailyRestMinutes, LIMITS.dailyDriving),
      drivingSinceBreak: take('drivingSinceBreakMinutes', s.drivingSinceBreakMinutes, LIMITS.continuousDriving),
      workSinceBreak: take('workSinceBreakMinutes', s.workSinceBreakMinutes, LIMITS.wtdWorkBeforeBreak),
    };
  } else if (s.onDuty == null && s.weeklyRestEndedAt.getTime() < asOf) {
    // Unknown whether on duty: the worst case is on duty
    // with the day's driving, the break and work used up, since as long ago
    // as a regular daily rest still fits the 24-hour window — so no driving
    // before a daily rest. Not before the weekly rest ended. While the weekly
    // rest still runs the driver is certainly resting.
    const latestStart = asOf - (LIMITS.dailyRestWindow - LIMITS.dailyRestRegular) * MINUTE_MS;
    shift = {
      dutyStart: Math.max(s.weeklyRestEndedAt.getTime(), latestStart),
      driving: LIMITS.dailyDriving,
      drivingSinceBreak: LIMITS.continuousDriving,
      workSinceBreak: LIMITS.wtdWorkBeforeBreak,
    };
    messages.push(msg('DRIVER_STATE_ASSUMED', { field: 'onDuty', value: true }));
  }

  if (now - asOf > STALE_AFTER_MS) messages.push(msg('DRIVER_STATUS_STALE', { asOf: s.asOf.toISOString() }));

  return {
    origin,
    earliestStart: Math.max(origin, s.unavailableUntil?.getTime() ?? origin),
    lastWeeklyRest,
    recentWeeklyRests: s.recentWeeklyRests?.map((r) => ({ type: r.type, endedAt: r.endedAt.getTime(), abroad: r.abroad })) ?? null,
    drivingThisWeek,
    drivingLastWeek,
    extendedDaysUsed,
    reducedDailyRestsUsed,
    compensation,
    lastHomeRestEndedAt: s.lastHomeRestEndedAt?.getTime() ?? null,
    homeRestDueBy,
    driverChoseToStayAway: s.driverChoseToStayAway,
    shift,
    messages,
  };
}

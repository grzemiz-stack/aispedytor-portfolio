/**
 * Driver status from an activity history (SPEC §5, docs/decisions.md §11).
 *
 * For an adapter that has the driver's activities but no status — a driver
 * card file, a tachograph program, telematics. The history is replayed by the
 * rules engine itself (`RulesTracker`), so the status is counted the same way
 * the plan is checked.
 *
 * The replay starts at the beginning of the coverage, where nothing is known:
 * the worst case (all reduced daily rests used, both 10-hour days used, no
 * compensation known). The first weekly rest in the window resets what it
 * resets in the rules, so from there on the counters are exact. What a
 * history cannot tell stays unknown (null) and the engine takes its worst
 * case with DRIVER_STATE_ASSUMED:
 *   - the rest at home — a tachograph does not record "home";
 *   - the compensation owed, until the coverage reaches the end of the third
 *     full fixed week after the week it starts in — 21 to 28 days, depending
 *     on the weekday it starts (a reduced rest before it may still be owed).
 * Required values the history does not give (no weekly rest in it, a week
 * not fully covered) refuse the status: DriverStatusError.
 *
 * Compensation is taken as paid only when a rest of at least 45 h is longer
 * than 45 h by the whole amount owed (en bloc). Art. 8(7) also allows it
 * attached to a daily rest (any rest of 9 h+); a history cannot tell that
 * from a long daily rest, so it stays owed — the cautious side (README,
 * "Known limits").
 */
import type { DriverActivityHistory } from '../activity/driver-activity-provider';
import { DriverStatusError, type DriverStatusSnapshot, type EngineStart, type WeeklyRestState } from './driver-state';
import { MINUTE_MS, endOfWeekAfter, minutesBetween, weekIndex, weekStart } from './fixed-week';
import { LIMITS } from './limits';
import { normalizeTimeline, type Segment } from './timeline';
import { RulesTracker } from './tracker';

export interface StatusFromHistoryOptions {
  /** The company's Member State of establishment (ISO 3166-1 alpha-2): a rest elsewhere is abroad. */
  establishmentCountry: string;
  /** The moment the status describes; default: the end of the coverage. Must lie inside the coverage. */
  asOf?: Date;
}

/** How long a history must cover for the compensation owed to be known: no reduced rest before it can still be owed. */
export const COMPENSATION_KNOWN_AFTER_WEEKS = LIMITS.compensationWeeksAfter;

export function statusFromHistory(history: DriverActivityHistory, options: StatusFromHistoryOptions): DriverStatusSnapshot {
  if (!history.coveredFrom || !history.coveredTo) throw new DriverStatusError('weeklyRestEndedAt');
  const from = history.coveredFrom.getTime();
  const asOf = (options.asOf ?? history.coveredTo).getTime();
  if (asOf < from || asOf > history.coveredTo.getTime()) throw new DriverStatusError('asOf');

  // Driving this week and last week are required: both weeks must be covered.
  const week = weekIndex(asOf);
  if (from > weekStart(week - 1)) throw new DriverStatusError('drivingLastWeekMinutes');

  const tracker = new RulesTracker(worstCaseStart(from));
  for (const s of normalizeTimeline(toSegments(history, asOf, options.establishmentCountry), from)) {
    if (s.type === 'REST') attachCompensation(s, tracker);
    tracker.apply(s);
  }
  if (tracker.t < asOf) tracker.apply({ type: 'REST', start: tracker.t, end: asOf });

  // Only weekly rests the history shows (not the placeholder).
  const rests = (tracker.recentWeeklyRests ?? []).filter((r) => r.endedAt > from);
  if (rests.length === 0) throw new DriverStatusError('weeklyRestEndedAt');
  const last = rests[0];

  const compensationKnown = endOfWeekAfter(from, COMPENSATION_KNOWN_AFTER_WEEKS) <= asOf;
  const owed = tracker.compensationOwedMinutes();
  const dueBy = owed > 0 ? Math.min(...tracker.compensation.filter((c) => c.minutes > 0).map((c) => c.dueBy)) : null;
  const onDuty = tracker.dutyStart != null;

  return {
    asOf: new Date(asOf),
    weeklyRestEndedAt: new Date(last.endedAt),
    weeklyRestType: last.type,
    weeklyRestAbroad: last.abroad,
    weeklyRestAtHome: false,
    recentWeeklyRests: rests.slice(0, 3).map((r) => ({ type: r.type, endedAt: new Date(r.endedAt), abroad: r.abroad })),
    drivingThisWeekMinutes: tracker.drivingInWeek(week),
    drivingLastWeekMinutes: tracker.drivingInWeek(week - 1),
    extendedDrivingDaysUsed: tracker.extendedDaysInWeek(week),
    reducedDailyRestsUsed: tracker.reducedDailyRestsUsed,
    compensationOwedMinutes: compensationKnown ? owed : null,
    compensationDueBy: compensationKnown && dueBy != null ? new Date(dueBy) : null,
    lastHomeRestEndedAt: null,
    driverChoseToStayAway: false,
    onDuty,
    dailyRestEndedAt: onDuty ? new Date(tracker.dutyStart!) : null,
    drivingSinceDailyRestMinutes: onDuty ? tracker.drivingInDuty : null,
    drivingSinceBreakMinutes: onDuty ? tracker.drivingSinceBreak : null,
    workSinceBreakMinutes: onDuty ? tracker.workSinceBreak : null,
    unavailableUntil: null,
  };
}

/**
 * Nothing known at the start of the coverage: every count used up. The
 * weekly rest it starts from is a placeholder ending a minute before the
 * coverage — so no rest in the history continues it, and it is dropped from
 * the result.
 */
function worstCaseStart(from: number): EngineStart {
  const placeholder: WeeklyRestState = { type: 'REDUCED', endedAt: from - MINUTE_MS, abroad: false };
  return {
    origin: from,
    earliestStart: from,
    lastWeeklyRest: placeholder,
    recentWeeklyRests: [placeholder],
    drivingThisWeek: 0,
    drivingLastWeek: 0,
    extendedDaysUsed: LIMITS.extendedDaysPerWeek,
    reducedDailyRestsUsed: LIMITS.reducedDailyRestsBetweenWeekly,
    compensation: [],
    lastHomeRestEndedAt: null,
    homeRestDueBy: from,
    driverChoseToStayAway: false,
    shift: null,
    messages: [],
  };
}

function toSegments(history: DriverActivityHistory, asOf: number, establishment: string): Segment[] {
  return history.activities
    .filter((a) => a.start.getTime() < asOf)
    .map((a) => {
      const s: Segment = { type: a.type, start: a.start.getTime(), end: Math.min(a.end.getTime(), asOf) };
      // Abroad only when the country is known: an unknown one does not open the exception for rests abroad.
      if (a.type === 'REST' && a.country && a.country !== establishment) s.abroad = true;
      return s;
    });
}

/** A rest of 45 h or more, longer by whole owed entries (oldest deadline first): those entries are taken in it. */
function attachCompensation(s: Segment, tracker: RulesTracker): void {
  let excess = minutesBetween(s.start, s.end) - LIMITS.weeklyRestRegular;
  if (excess <= 0) return;
  let paid = 0;
  for (const c of [...tracker.compensation].sort((a, b) => a.dueBy - b.dueBy)) {
    if (c.minutes <= 0) continue;
    if (c.minutes > excess) break;
    paid += c.minutes;
    excess -= c.minutes;
  }
  if (paid > 0) s.compensationMinutes = paid;
}

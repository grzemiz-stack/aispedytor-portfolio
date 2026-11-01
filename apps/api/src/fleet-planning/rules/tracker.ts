/**
 * The rules ledger: walks a normalized timeline segment by segment, keeps
 * every counter 561/2006 and 2002/15 need, and records each rule broken.
 *
 * The validator (`check-timeline.ts`) is this walk over a whole timeline.
 * The planner asks the same ledger what is left before each step, so a
 * planner decision is always checked by the rule that would reject it.
 *
 * Rest classification (after subtracting compensation taken in the rest):
 *   ≥ 24 h weekly rest (≥ 45 h regular, else reduced);
 *   9–24 h daily rest (≥ 11 h, or ≥ 9 h after a 3 h first part: regular; else reduced);
 *   3–9 h first part of a split daily rest (and a break);
 *   ≥ 15 min break (45 min full; 15 then 30 a split break; ≥ 15 min a 2002/15 break part).
 */
import { msg, type PlanMessage } from '../../common/plan-messages';
import { LIMITS } from './limits';
import { MINUTE_MS, addMinutes, endOfWeekAfter, minutesBetween, nextWeekStart, weekIndex } from './fixed-week';
import type { CompensationOwed, EngineStart, WeeklyRestKind, WeeklyRestState } from './driver-state';
import type { Segment } from './timeline';

const iso = (t: number) => new Date(t).toISOString();

export interface CompensationEntry extends CompensationOwed {
  /** The reduction this compensation is for: the start of the reduced weekly rest (null = from the status). */
  reducedRestStart: number | null;
  /** Must be taken before the next weekly rest (two consecutive reduced, art. 8(6) last subparagraph). */
  beforeNextWeeklyRest: boolean;
  overdueReported: boolean;
}

export class RulesTracker {
  readonly violations: PlanMessage[] = [];
  readonly warnings: PlanMessage[] = [];
  readonly notices: PlanMessage[] = [];

  /** Current instant. */
  t: number;

  // ── duty period (since the end of the last daily or weekly rest) ─────────
  /** End of the last qualifying rest; null while the driver is resting with no duty open. */
  dutyStart: number | null;
  drivingInDuty = 0;
  extendedThisDuty = false;
  drivingSinceBreak = 0;
  splitBreakFirstTaken = false;
  splitDailyRestFirstTaken = false;
  /** 2002/15: work (driving + other work) in the duty period, since the last break, and breaks taken. */
  workInDuty = 0;
  workSinceBreak = 0;
  wtdBreaksInDuty = 0;
  private dutyFlags = new Set<string>();

  // ── week ─────────────────────────────────────────────────────────────────
  private drivingByWeek = new Map<number, number>();
  private extendedByWeek = new Map<number, number>();
  private weekFlags = new Set<string>();

  // ── weekly rest ──────────────────────────────────────────────────────────
  lastWeeklyRest: WeeklyRestState;
  /** Newest first, including `lastWeeklyRest`; null = history unknown. */
  recentWeeklyRests: WeeklyRestState[] | null;
  reducedDailyRestsUsed: number;
  compensation: CompensationEntry[];
  private weeklyLateReported = false;

  // ── return home (art. 8(8a)) ─────────────────────────────────────────────
  /** null while unknown (then `homeRestDueBy` gives the deadline). */
  lastHomeRestEndedAt: number | null;
  /** The deadline assumed for an unknown last rest at home; cleared by the next rest at home. */
  private homeRestDueBy: number | null;
  twoConsecutiveReduced = false;
  readonly driverChoseToStayAway: boolean;
  private homeReported = false;

  /** A leading rest of a driver who is not on duty continues the rest the status describes. */
  private resting: boolean;

  constructor(start: EngineStart) {
    this.t = start.origin;
    this.lastWeeklyRest = { ...start.lastWeeklyRest };
    this.recentWeeklyRests = start.recentWeeklyRests?.map((r) => ({ ...r })) ?? null;
    this.reducedDailyRestsUsed = start.reducedDailyRestsUsed;
    this.compensation = start.compensation.map((c) => ({ ...c, reducedRestStart: null, beforeNextWeeklyRest: false, overdueReported: false }));
    this.lastHomeRestEndedAt = start.lastHomeRestEndedAt;
    this.homeRestDueBy = start.homeRestDueBy;
    this.driverChoseToStayAway = start.driverChoseToStayAway;
    const w = weekIndex(start.origin);
    this.drivingByWeek.set(w, start.drivingThisWeek);
    this.drivingByWeek.set(w - 1, start.drivingLastWeek);
    this.extendedByWeek.set(w, start.extendedDaysUsed);
    // The 3-week return period applies after two consecutive reduced weekly rests.
    // (With the rest at home unknown its deadline is already `asOf`; the period does not matter.)
    const [r0, r1] = this.recentWeeklyRests ?? [];
    const lastHome = this.lastHomeRestEndedAt;
    if (lastHome != null && this.recentWeeklyRests) {
      this.twoConsecutiveReduced = r0?.type === 'REDUCED' && r1?.type === 'REDUCED' && r1.endedAt > lastHome;
    } else if (lastHome != null && this.lastWeeklyRest.type === 'REDUCED' && this.lastWeeklyRest.endedAt > lastHome) {
      // The rest before it is unknown: the shorter (3-week) return period is assumed.
      this.twoConsecutiveReduced = true;
      this.notices.push(msg('DRIVER_STATE_ASSUMED', { field: 'recentWeeklyRests', value: 'REDUCED' }));
    }

    if (start.shift) {
      this.resting = false;
      this.dutyStart = start.shift.dutyStart;
      this.drivingInDuty = start.shift.driving;
      this.extendedThisDuty = start.shift.driving > LIMITS.dailyDriving;
      this.drivingSinceBreak = start.shift.drivingSinceBreak;
      // 2002/15 totals start from the work since the last break (earlier breaks are not known).
      this.workSinceBreak = start.shift.workSinceBreak;
      this.workInDuty = start.shift.workSinceBreak;
    } else {
      this.resting = true;
      this.dutyStart = null;
    }
    this.stateViolations(start);
  }

  /** A status may already describe a broken rule: reported at the origin, not hidden. */
  private stateViolations(start: EngineStart): void {
    const at = iso(start.origin);
    if (start.shift && start.shift.drivingSinceBreak > LIMITS.continuousDriving) this.violations.push(msg('BREAK_MISSING', { at }));
    if (start.shift && start.shift.driving > LIMITS.dailyDrivingExtended) {
      this.dutyViolation('day10', 'DAILY_DRIVING_EXCEEDED', { at, limitMinutes: LIMITS.dailyDrivingExtended });
    }
    if (start.shift && start.shift.workSinceBreak > LIMITS.wtdWorkBeforeBreak) this.dutyViolation('wtd-run', 'WTD_BREAK_MISSING', { at, rule: 'CONSECUTIVE' });
    const w = weekIndex(start.origin);
    if (start.drivingThisWeek > LIMITS.weeklyDriving) this.weekViolation(`week:${w}`, 'WEEKLY_DRIVING_EXCEEDED', { at });
    if (start.drivingLastWeek > LIMITS.weeklyDriving) this.weekViolation(`week:${w - 1}`, 'WEEKLY_DRIVING_EXCEEDED', { at });
    if (start.drivingThisWeek + start.drivingLastWeek > LIMITS.fortnightDriving) this.weekViolation(`fortnight:${w}`, 'FORTNIGHT_DRIVING_EXCEEDED', { at });
    if (start.reducedDailyRestsUsed > LIMITS.reducedDailyRestsBetweenWeekly) this.violations.push(msg('REDUCED_DAILY_RESTS_EXCEEDED', { at }));
    if (start.extendedDaysUsed > LIMITS.extendedDaysPerWeek) this.weekViolation(`ext:${w}`, 'DAILY_DRIVING_EXCEEDED', { at, limitMinutes: LIMITS.dailyDriving });
    // Deadlines already passed at the origin.
    for (const c of this.compensation) {
      if (c.dueBy < start.origin) {
        c.overdueReported = true;
        this.violations.push(msg('COMPENSATION_OVERDUE', { at: iso(c.dueBy) }));
      }
    }
    if (this.homeRestDueBy != null || start.origin > this.homeRestDeadline()) this.reportHomeLate();
  }

  // ── queries (also used by the planner) ───────────────────────────────────

  drivingInWeek(w: number): number {
    return this.drivingByWeek.get(w) ?? 0;
  }

  extendedDaysInWeek(w: number): number {
    return this.extendedByWeek.get(w) ?? 0;
  }

  /** The week whose 10-hour allowance the current duty period uses: the week it started in. */
  dutyWeek(): number {
    return weekIndex(this.dutyStart ?? this.t);
  }

  /** Latest start of the next weekly rest (art. 8(6)). */
  weeklyRestDeadline(): number {
    return addMinutes(this.lastWeeklyRest.endedAt, LIMITS.weeklyRestLatestStartAfter);
  }

  /** Latest start of the next home rest (art. 8(8a)). */
  homeRestDeadline(): number {
    if (this.homeRestDueBy != null) return this.homeRestDueBy;
    const period = this.twoConsecutiveReduced ? LIMITS.homeReturnPeriodAfterTwoReduced : LIMITS.homeReturnPeriod;
    return addMinutes(this.lastHomeRestEndedAt!, period);
  }

  /** End of the 24-hour window in which the next daily rest must be taken; null while resting. */
  dailyRestWindowEnd(): number | null {
    return this.dutyStart == null ? null : addMinutes(this.dutyStart, LIMITS.dailyRestWindow);
  }

  /** How long the next daily rest must be: 9 h if a reduced one (or the second part of a split) is still possible. */
  minimumNextDailyRest(): number {
    return this.splitDailyRestFirstTaken || this.reducedDailyRestsUsed < LIMITS.reducedDailyRestsBetweenWeekly
      ? LIMITS.dailyRestReduced
      : LIMITS.dailyRestRegular;
  }

  /** Whether the next weekly rest may be reduced (no reduced weekly rest just before it). */
  nextWeeklyRestMayBeReduced(): boolean {
    return this.lastWeeklyRest.type === 'REGULAR';
  }

  compensationOwedMinutes(): number {
    return this.compensation.reduce((sum, c) => sum + c.minutes, 0);
  }

  // ── the walk ─────────────────────────────────────────────────────────────

  apply(s: Segment): void {
    if (s.type === 'REST') this.rest(s);
    else this.activity(s);
    this.t = s.end;
    this.checkDeadlines(s);
  }

  private activity(s: Segment): void {
    if (this.dutyStart == null) this.dutyStart = s.start;
    this.resting = false;
    const windowEnd = this.dailyRestWindowEnd()!;
    // The daily rest must fit in the 24-hour window: it has to start by windowEnd − its length.
    if (s.end > addMinutes(windowEnd, -this.minimumNextDailyRest())) {
      this.dutyViolation('late', 'DAILY_REST_LATE', { at: iso(addMinutes(windowEnd, -this.minimumNextDailyRest())), dutyStart: iso(this.dutyStart) });
    }
    if (s.end > this.weeklyRestDeadline() && !this.weeklyLateReported) {
      this.weeklyLateReported = true;
      this.violations.push(msg('WEEKLY_REST_LATE', { at: iso(this.weeklyRestDeadline()) }));
    }
    if (s.type === 'AVAILABILITY') return;

    // Split at week boundaries so each minute is counted in its own fixed week.
    let from = s.start;
    while (from < s.end) {
      const to = Math.min(s.end, nextWeekStart(from));
      const minutes = minutesBetween(from, to);
      if (s.type === 'DRIVE') this.drive(from, minutes);
      this.work(from, minutes);
      from = to;
    }
  }

  private drive(from: number, minutes: number): void {
    // 561 art. 7: break after 4.5 h of driving.
    const beforeBreak = this.drivingSinceBreak;
    this.drivingSinceBreak += minutes;
    if (beforeBreak <= LIMITS.continuousDriving && this.drivingSinceBreak > LIMITS.continuousDriving) {
      this.violations.push(msg('BREAK_MISSING', { at: iso(addMinutes(from, LIMITS.continuousDriving - beforeBreak)) }));
    }

    // 561 art. 6(1): 9 h, or 10 h twice in the fixed week.
    const beforeDay = this.drivingInDuty;
    this.drivingInDuty += minutes;
    if (beforeDay <= LIMITS.dailyDriving && this.drivingInDuty > LIMITS.dailyDriving && !this.extendedThisDuty) {
      const w = this.dutyWeek();
      if (this.extendedDaysInWeek(w) < LIMITS.extendedDaysPerWeek) {
        this.extendedByWeek.set(w, this.extendedDaysInWeek(w) + 1);
        this.extendedThisDuty = true;
      } else {
        this.dutyViolation('day9', 'DAILY_DRIVING_EXCEEDED', { at: iso(addMinutes(from, LIMITS.dailyDriving - beforeDay)), limitMinutes: LIMITS.dailyDriving });
      }
    }
    if (beforeDay <= LIMITS.dailyDrivingExtended && this.drivingInDuty > LIMITS.dailyDrivingExtended) {
      this.dutyViolation('day10', 'DAILY_DRIVING_EXCEEDED', { at: iso(addMinutes(from, LIMITS.dailyDrivingExtended - beforeDay)), limitMinutes: LIMITS.dailyDrivingExtended });
    }

    // 561 art. 6(2)–(3): 56 h in the fixed week, 90 h in two consecutive weeks.
    const w = weekIndex(from);
    const beforeWeek = this.drivingInWeek(w);
    this.drivingByWeek.set(w, beforeWeek + minutes);
    if (beforeWeek <= LIMITS.weeklyDriving && beforeWeek + minutes > LIMITS.weeklyDriving) {
      this.weekViolation(`week:${w}`, 'WEEKLY_DRIVING_EXCEEDED', { at: iso(addMinutes(from, LIMITS.weeklyDriving - beforeWeek)) });
    }
    const prev = this.drivingInWeek(w - 1);
    if (prev + beforeWeek <= LIMITS.fortnightDriving && prev + beforeWeek + minutes > LIMITS.fortnightDriving) {
      this.weekViolation(`fortnight:${w}`, 'FORTNIGHT_DRIVING_EXCEEDED', { at: iso(addMinutes(from, LIMITS.fortnightDriving - prev - beforeWeek)) });
    }
  }

  private work(from: number, minutes: number): void {
    // 2002/15 art. 5: not more than 6 consecutive hours without a break;
    // 30 min of breaks once work exceeds 6 h, 45 min once it exceeds 9 h.
    const beforeRun = this.workSinceBreak;
    this.workSinceBreak += minutes;
    if (beforeRun <= LIMITS.wtdWorkBeforeBreak && this.workSinceBreak > LIMITS.wtdWorkBeforeBreak) {
      this.dutyViolation('wtd-run', 'WTD_BREAK_MISSING', { at: iso(addMinutes(from, LIMITS.wtdWorkBeforeBreak - beforeRun)), rule: 'CONSECUTIVE' });
    }
    const before = this.workInDuty;
    this.workInDuty += minutes;
    if (before <= LIMITS.wtdWorkBeforeBreak && this.workInDuty > LIMITS.wtdWorkBeforeBreak && this.wtdBreaksInDuty < LIMITS.wtdBreakOver6h) {
      this.dutyViolation('wtd-6', 'WTD_BREAK_MISSING', { at: iso(addMinutes(from, LIMITS.wtdWorkBeforeBreak - before)), rule: 'OVER_6H' });
    }
    if (before <= LIMITS.wtdLongDay && this.workInDuty > LIMITS.wtdLongDay && this.wtdBreaksInDuty < LIMITS.wtdBreakOver9h) {
      this.dutyViolation('wtd-9', 'WTD_BREAK_MISSING', { at: iso(addMinutes(from, LIMITS.wtdLongDay - before)), rule: 'OVER_9H' });
    }
  }

  private rest(s: Segment): void {
    const total = minutesBetween(s.start, s.end);
    const compensation = Math.min(s.compensationMinutes ?? 0, total);
    const effective = total - compensation;

    // A rest that opens the timeline of a driver not on duty continues the
    // rest the status describes — it is not classified on its own.
    const continuesWeeklyRest = this.lastWeeklyRest.endedAt === s.start;
    if (this.resting && !continuesWeeklyRest && effective >= LIMITS.weeklyRestReduced) {
      // Started before the origin (unknown when): at least this long, so classified as it is.
      this.resting = false;
    }
    if (this.resting) {
      if (continuesWeeklyRest) this.lastWeeklyRest = { ...this.lastWeeklyRest, endedAt: s.end };
      if (this.recentWeeklyRests?.[0] && this.recentWeeklyRests[0].endedAt === s.start) this.recentWeeklyRests[0] = { ...this.recentWeeklyRests[0], endedAt: s.end };
      if (this.lastHomeRestEndedAt === s.start) this.lastHomeRestEndedAt = s.end;
      if (compensation > 0) this.payCompensation(s, compensation, effective);
      return;
    }

    if (compensation > 0) this.payCompensation(s, compensation, effective);

    if (effective >= LIMITS.wtdBreakPartMin) {
      this.wtdBreaksInDuty += effective;
      this.workSinceBreak = 0;
    }
    if (effective >= LIMITS.break || (effective >= LIMITS.splitBreakSecond && this.splitBreakFirstTaken)) {
      this.drivingSinceBreak = 0;
      this.splitBreakFirstTaken = false;
    } else if (effective >= LIMITS.splitBreakFirst) {
      this.splitBreakFirstTaken = true;
    }

    if (effective >= LIMITS.weeklyRestReduced) this.weeklyRest(s, total, effective);
    else if (effective >= LIMITS.dailyRestReduced) this.dailyRest(effective);
    else if (effective >= LIMITS.splitDailyRestFirst) this.splitDailyRestFirstTaken = true;
  }

  private dailyRest(effective: number): void {
    const regular = effective >= LIMITS.dailyRestRegular || this.splitDailyRestFirstTaken;
    if (!regular) {
      this.reducedDailyRestsUsed += 1;
      if (this.reducedDailyRestsUsed === LIMITS.reducedDailyRestsBetweenWeekly + 1) {
        this.violations.push(msg('REDUCED_DAILY_RESTS_EXCEEDED', { at: iso(this.t) }));
      }
    }
    this.endDuty();
  }

  private weeklyRest(s: Segment, total: number, effective: number): void {
    const type: WeeklyRestKind = effective >= LIMITS.weeklyRestRegular ? 'REGULAR' : 'REDUCED';
    const abroad = Boolean(s.abroad);

    if (s.start > this.weeklyRestDeadline() && !this.weeklyLateReported) {
      this.weeklyLateReported = true;
      this.violations.push(msg('WEEKLY_REST_LATE', { at: iso(this.weeklyRestDeadline()) }));
    }

    // Compensation owed for two consecutive reduced rests must come first.
    for (const c of this.compensation) {
      if (c.beforeNextWeeklyRest && c.minutes > 0) {
        this.violations.push(msg('COMPENSATION_NOT_BEFORE_WEEKLY_REST', { at: iso(s.start) }));
        break;
      }
    }
    for (const c of this.compensation) c.beforeNextWeeklyRest = false;

    let twoReducedNow = false;
    if (type === 'REDUCED' && this.lastWeeklyRest.type === 'REDUCED') {
      twoReducedNow = true;
      const verdict = this.exceptionApplies(s, abroad);
      if (verdict === 'APPLIES') {
        this.notices.push(msg('WEEKLY_REST_EXCEPTION_APPLIED', { at: iso(s.start) }));
        for (const c of this.compensation) if (c.minutes > 0) c.beforeNextWeeklyRest = true;
      } else {
        this.violations.push(msg('CONSECUTIVE_REDUCED_WEEKLY_RESTS', { at: iso(s.start) }));
        if (verdict === 'UNVERIFIABLE') this.notices.push(msg('WEEKLY_REST_EXCEPTION_UNVERIFIABLE', { at: iso(s.start) }));
      }
    }

    if (type === 'REDUCED') {
      const entry: CompensationEntry = {
        minutes: LIMITS.weeklyRestRegular - effective,
        dueBy: endOfWeekAfter(s.start, LIMITS.compensationWeeksAfter),
        reducedRestStart: s.start,
        beforeNextWeeklyRest: twoReducedNow,
        overdueReported: false,
      };
      this.compensation.push(entry);
      if (twoReducedNow) for (const c of this.compensation) if (c.minutes > 0) c.beforeNextWeeklyRest = true;
    }

    // Regular weekly rest, or a weekly rest over 45 h taken with compensation (art. 8(8), (8a)).
    const long = type === 'REGULAR' || total > LIMITS.weeklyRestRegular;
    if (long && s.inCab) this.violations.push(msg('WEEKLY_REST_IN_CAB', { at: iso(s.start) }));
    else if (long && s.place !== 'HOME') {
      this.notices.push(msg('WEEKLY_REST_ACCOMMODATION_REQUIRED', { at: iso(s.start), hours: Math.round(total / 60) }));
    }
    if (long && s.place === 'HOME') {
      if (s.start > this.homeRestDeadline() && !this.homeReported) this.reportHomeLate();
      this.lastHomeRestEndedAt = s.end;
      this.homeRestDueBy = null;
      this.twoConsecutiveReduced = false;
      this.homeReported = false;
    } else if (twoReducedNow && abroad) {
      this.twoConsecutiveReduced = true;
    }

    const rest: WeeklyRestState = { type, endedAt: s.end, abroad };
    this.lastWeeklyRest = rest;
    if (this.recentWeeklyRests) this.recentWeeklyRests = [rest, ...this.recentWeeklyRests].slice(0, 4);
    this.reducedDailyRestsUsed = 0;
    this.weeklyLateReported = false;
    this.endDuty();
  }

  /**
   * Art. 8(6) third subparagraph: two consecutive reduced weekly rests,
   * both outside the Member State of establishment, if in four consecutive
   * weeks there are four weekly rests, at least two of them regular.
   * Interpretation: the two rests before the pair are regular and the ends
   * of the four rests lie within 28 days.
   */
  private exceptionApplies(s: Segment, abroad: boolean): 'APPLIES' | 'FAILS' | 'UNVERIFIABLE' {
    const history = this.recentWeeklyRests;
    if (!history || history.length < 3) return 'UNVERIFIABLE';
    const [previous, r2, r3] = history;
    const ok =
      abroad &&
      previous.abroad &&
      r2.type === 'REGULAR' &&
      r3.type === 'REGULAR' &&
      s.end - r3.endedAt <= LIMITS.exceptionWindow * MINUTE_MS;
    return ok ? 'APPLIES' : 'FAILS';
  }

  private payCompensation(s: Segment, minutes: number, effective: number): void {
    if (effective < LIMITS.compensationAttachedToRestOfAtLeast) {
      this.violations.push(msg('COMPENSATION_INVALID', { at: iso(s.start) }));
      return;
    }
    // The compensation block may open the rest it is attached to: it is
    // taken by `start + its minutes`, whatever the length of the whole rest.
    let left = minutes;
    let takenBy = s.start;
    for (const c of [...this.compensation].sort((a, b) => a.dueBy - b.dueBy)) {
      if (left <= 0) break;
      const paid = Math.min(c.minutes, left);
      if (paid <= 0) continue;
      // En bloc: a part of an entry does not compensate it.
      if (paid < c.minutes) break;
      c.minutes = 0;
      left -= paid;
      takenBy = addMinutes(takenBy, paid);
      if (takenBy > c.dueBy && !c.overdueReported) {
        c.overdueReported = true;
        this.violations.push(msg('COMPENSATION_OVERDUE', { at: iso(c.dueBy) }));
      }
    }
    this.compensation = this.compensation.filter((c) => c.minutes > 0);
  }

  private checkDeadlines(s: Segment): void {
    for (const c of this.compensation) {
      if (c.minutes > 0 && s.end > c.dueBy && !c.overdueReported) {
        c.overdueReported = true;
        this.violations.push(msg('COMPENSATION_OVERDUE', { at: iso(c.dueBy) }));
      }
    }
    if (s.end > this.homeRestDeadline() && !this.homeReported) this.reportHomeLate();
  }

  /** The company must enable the return (art. 8(8a)); the driver may choose to stay away — a warning, not a violation. */
  private reportHomeLate(): void {
    this.homeReported = true;
    const params = { at: iso(this.homeRestDeadline()) };
    if (this.driverChoseToStayAway) this.notices.push(msg('HOME_RETURN_DECLINED', params));
    else this.warnings.push(msg('HOME_RETURN_LATE', params));
  }

  private endDuty(): void {
    this.dutyStart = null;
    this.drivingInDuty = 0;
    this.extendedThisDuty = false;
    this.drivingSinceBreak = 0;
    this.splitBreakFirstTaken = false;
    this.splitDailyRestFirstTaken = false;
    this.workInDuty = 0;
    this.workSinceBreak = 0;
    this.wtdBreaksInDuty = 0;
    this.dutyFlags.clear();
  }

  /** One violation of a kind per duty period. */
  private dutyViolation(key: string, code: Parameters<typeof msg>[0], params: Record<string, string | number>): void {
    if (this.dutyFlags.has(key)) return;
    this.dutyFlags.add(key);
    this.violations.push(msg(code, params));
  }

  /** One violation of a kind per week. */
  private weekViolation(key: string, code: Parameters<typeof msg>[0], params: Record<string, string | number>): void {
    if (this.weekFlags.has(key)) return;
    this.weekFlags.add(key);
    this.violations.push(msg(code, params));
  }
}

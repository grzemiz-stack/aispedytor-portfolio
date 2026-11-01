/**
 * The planner: a driver's state and an ordered list of tasks → a timeline
 * with the breaks and rests inserted, and the ETA.
 *
 * Greedy and deterministic: before each step it asks the rules ledger how
 * much is left and inserts the rest that the first limit reached requires.
 * Driving may be split by a break or a rest; WORK and AVAILABILITY tasks are
 * never split. A task that cannot fit legally is still placed and reported
 * (TASK_CANNOT_FIT_LEGALLY) — the dispatcher decides (SPEC §2).
 *
 * Strategies:
 *   standard — 9 h driving days, 11 h daily rests, regular weekly rests;
 *   earliest — also 10-hour days, 9 h daily rests and 24 h weekly rests
 *              (with the compensation owed), for the earliest legal ETA.
 *              Greedy: legal, not always the earliest possible.
 *
 * The result's violations come from the validator run on the finished
 * timeline, not from the planner's own bookkeeping.
 */
import { msg, type PlanMessage } from '../../common/plan-messages';
import { checkTimeline, type CheckResult } from './check-timeline';
import type { EngineStart } from './driver-state';
import { LIMITS } from './limits';
import { addMinutes, minutesBetween, nextWeekStart, weekIndex } from './fixed-week';
import type { Segment } from './timeline';
import { RulesTracker } from './tracker';

export type PlanStrategy = 'standard' | 'earliest';

export interface PlanTask {
  type: 'DRIVE' | 'WORK' | 'AVAILABILITY';
  /** Whole minutes, > 0. */
  minutes: number;
}

export interface PlanOptions {
  strategy?: PlanStrategy;
  /** Do not start before this instant (epoch ms); default: as early as the driver can. */
  startAt?: number;
  /** Rests the planner inserts are taken outside the Member State of establishment. */
  restsAbroad?: boolean;
}

export interface PlanResult extends CheckResult {
  segments: Segment[];
  /** End of the last task (epoch ms). */
  eta: number;
  /** Planner-only messages (TASK_CANNOT_FIT_LEGALLY). */
  planNotes: PlanMessage[];
}

const iso = (t: number) => new Date(t).toISOString();
const MAX_STEPS = 10_000;

export function planTimeline(start: EngineStart, tasks: readonly PlanTask[], options: PlanOptions = {}): PlanResult {
  const p = new Planner(start, options);
  tasks.forEach((task, i) => p.task(task, i));
  const check = checkTimeline(start, p.segments);
  return { ...check, segments: p.segments, eta: p.tracker.t, planNotes: p.notes };
}

class Planner {
  readonly segments: Segment[] = [];
  readonly notes: PlanMessage[] = [];
  readonly tracker: RulesTracker;
  private readonly strategy: PlanStrategy;
  private steps = 0;

  constructor(start: EngineStart, private readonly options: PlanOptions) {
    this.tracker = new RulesTracker(start);
    this.strategy = options.strategy ?? 'standard';
    const from = Math.max(start.earliestStart, options.startAt ?? start.earliestStart);
    if (from > start.origin) this.emit({ type: 'REST', start: start.origin, end: from, reason: 'WAIT' });
  }

  task(task: PlanTask, index: number): void {
    if (task.type === 'DRIVE') this.drive(task.minutes, index);
    else this.atomic(task, index);
  }

  // ── driving: split as the limits require ───────────────────────────────
  private drive(minutes: number, index: number): void {
    let left = minutes;
    while (left > 0) {
      this.guard();
      const chunk = Math.min(left, this.drivingAllowed());
      if (chunk > 0) {
        this.emit({ type: 'DRIVE', start: this.now, end: addMinutes(this.now, chunk), taskIndex: index });
        left -= chunk;
      } else {
        this.restForDriving();
      }
    }
  }

  /** Whole minutes of driving allowed from now before some limit is reached. */
  private drivingAllowed(): number {
    const tr = this.tracker;
    const w = weekIndex(this.now);
    return Math.floor(
      Math.min(
        LIMITS.continuousDriving - tr.drivingSinceBreak,
        this.dailyDrivingCap() - tr.drivingInDuty,
        LIMITS.weeklyDriving - tr.drivingInWeek(w),
        LIMITS.fortnightDriving - tr.drivingInWeek(w) - tr.drivingInWeek(w - 1),
        this.workAllowed(),
        minutesBetween(this.now, this.latestDailyRestStart()),
        minutesBetween(this.now, this.tracker.weeklyRestDeadline()),
      ),
    );
  }

  private restForDriving(): void {
    const tr = this.tracker;
    const w = weekIndex(this.now);
    const weekSpent =
      tr.drivingInWeek(w) >= LIMITS.weeklyDriving ||
      tr.drivingInWeek(w) + tr.drivingInWeek(w - 1) >= LIMITS.fortnightDriving;
    if (this.reached(tr.weeklyRestDeadline()) || weekSpent) return this.weeklyRest(weekSpent);
    if (tr.drivingInDuty >= this.dailyDrivingCap() || this.reached(this.latestDailyRestStart())) return this.dailyRest();
    if (tr.drivingSinceBreak >= LIMITS.continuousDriving) return this.breakFor(tr.splitBreakFirstTaken ? LIMITS.splitBreakSecond : LIMITS.break);
    return this.breakFor(this.wtdBreakNeeded());
  }

  // ── WORK / AVAILABILITY: never split ───────────────────────────────────
  private atomic(task: PlanTask, index: number): void {
    let cannotFit = false;
    for (;;) {
      this.guard();
      const end = addMinutes(this.now, task.minutes);
      if (end > this.tracker.weeklyRestDeadline()) {
        if (this.lastWasRest('WEEKLY_REST')) { cannotFit = true; break; }
        this.weeklyRest(false);
      } else if (end > this.latestDailyRestStart()) {
        const longerThanAnyDuty = task.minutes > LIMITS.dailyRestWindow - this.dailyRestLength();
        if (longerThanAnyDuty || this.lastWasRest('DAILY_REST') || this.lastWasRest('WEEKLY_REST')) {
          // Rest first only if a duty is open (do not make it longer); then place it, reported.
          if (longerThanAnyDuty && this.tracker.dutyStart != null && !this.lastWasRest('DAILY_REST')) this.dailyRest();
          cannotFit = true;
          break;
        }
        this.dailyRest();
      } else if (task.type === 'WORK' && task.minutes > LIMITS.wtdWorkBeforeBreak) {
        // Longer than 2002/15 allows without a break: placed after a break, reported.
        if (this.tracker.workSinceBreak > 0 && !this.lastWasRest('BREAK')) this.breakFor(this.wtdBreakNeeded(task.minutes));
        cannotFit = true;
        break;
      } else if (task.type === 'WORK' && task.minutes > this.workAllowed()) {
        this.breakFor(this.wtdBreakNeeded(task.minutes));
      } else {
        break;
      }
    }
    if (cannotFit) this.notes.push(msg('TASK_CANNOT_FIT_LEGALLY', { taskIndex: index, at: iso(this.now) }));
    this.emit({ type: task.type, start: this.now, end: addMinutes(this.now, task.minutes), taskIndex: index });
  }

  // ── limits from the planner's point of view ────────────────────────────

  private get now(): number {
    return this.tracker.t;
  }

  /** Less than a whole minute before `t` (instants need not fall on whole minutes). */
  private reached(t: number): boolean {
    return minutesBetween(this.now, t) < 1;
  }

  private dailyDrivingCap(): number {
    const tr = this.tracker;
    if (this.strategy !== 'earliest') return LIMITS.dailyDriving;
    const extendedLeft = tr.extendedThisDuty || tr.extendedDaysInWeek(tr.dutyWeek()) < LIMITS.extendedDaysPerWeek;
    return extendedLeft ? LIMITS.dailyDrivingExtended : LIMITS.dailyDriving;
  }

  /** The daily rest the planner will take next. */
  private dailyRestLength(): number {
    const reducedLeft = this.tracker.reducedDailyRestsUsed < LIMITS.reducedDailyRestsBetweenWeekly;
    return this.strategy === 'earliest' && reducedLeft ? LIMITS.dailyRestReduced : LIMITS.dailyRestRegular;
  }

  /** Latest start of that rest inside the 24-hour window (a fresh duty opens the window now). */
  private latestDailyRestStart(): number {
    const windowEnd = this.tracker.dailyRestWindowEnd() ?? addMinutes(this.now, LIMITS.dailyRestWindow);
    return addMinutes(windowEnd, -this.dailyRestLength());
  }

  /** 2002/15: minutes of work allowed before a break is required. */
  private workAllowed(): number {
    const tr = this.tracker;
    let allowed = LIMITS.wtdWorkBeforeBreak - tr.workSinceBreak;
    // At exactly the threshold the break is still owed: the validator counts any minute past it.
    if (tr.workInDuty <= LIMITS.wtdWorkBeforeBreak && tr.wtdBreaksInDuty < LIMITS.wtdBreakOver6h) {
      allowed = Math.min(allowed, LIMITS.wtdWorkBeforeBreak - tr.workInDuty);
    } else if (tr.workInDuty <= LIMITS.wtdLongDay && tr.wtdBreaksInDuty < LIMITS.wtdBreakOver9h) {
      allowed = Math.min(allowed, LIMITS.wtdLongDay - tr.workInDuty);
    }
    return allowed;
  }

  /** The 2002/15 break that lets `upcoming` minutes of work through. */
  private wtdBreakNeeded(upcoming = 1): number {
    const tr = this.tracker;
    const total = tr.workInDuty + upcoming;
    const target = total > LIMITS.wtdLongDay ? LIMITS.wtdBreakOver9h : total > LIMITS.wtdWorkBeforeBreak ? LIMITS.wtdBreakOver6h : 0;
    return Math.max(LIMITS.wtdBreakPartMin, target - tr.wtdBreaksInDuty);
  }

  // ── inserting rests ────────────────────────────────────────────────────

  private breakFor(minutes: number): void {
    this.emit({ type: 'REST', start: this.now, end: addMinutes(this.now, minutes), reason: 'BREAK' });
  }

  private dailyRest(): void {
    const tr = this.tracker;
    const length = this.dailyRestLength();
    // A daily rest that would end after the weekly deadline: take the weekly rest now.
    if (addMinutes(this.now, length) > tr.weeklyRestDeadline()) return this.weeklyRest(false);
    const compensation = this.compensationDueBefore(addMinutes(tr.weeklyRestDeadline(), LIMITS.weeklyRestRegular));
    this.emit({
      type: 'REST',
      start: this.now,
      end: addMinutes(this.now, length + compensation),
      reason: 'DAILY_REST',
      ...(compensation > 0 ? { compensationMinutes: compensation } : {}),
      ...(this.options.restsAbroad ? { abroad: true } : {}),
    });
  }

  private weeklyRest(untilNextWeek: boolean): void {
    const tr = this.tracker;
    const reduced = this.strategy === 'earliest' && tr.nextWeeklyRestMayBeReduced();
    let length = reduced ? LIMITS.weeklyRestReduced : LIMITS.weeklyRestRegular;
    // No driving left this week: rest at least until Monday 00:00.
    if (untilNextWeek) length = Math.max(length, Math.ceil(minutesBetween(this.now, nextWeekStart(this.now))));
    const compensation = tr.compensationOwedMinutes();
    this.emit({
      type: 'REST',
      start: this.now,
      end: addMinutes(this.now, length + compensation),
      reason: 'WEEKLY_REST',
      inCab: false,
      ...(compensation > 0 ? { compensationMinutes: compensation } : {}),
      ...(this.options.restsAbroad ? { abroad: true } : {}),
    });
  }

  /** Compensation that cannot wait for the next weekly rest (due before `latestNextWeeklyEnd`). */
  private compensationDueBefore(latestNextWeeklyEnd: number): number {
    return this.tracker.compensation.some((c) => c.dueBy < latestNextWeeklyEnd) ? this.tracker.compensationOwedMinutes() : 0;
  }

  private lastWasRest(reason: Segment['reason']): boolean {
    const last = this.segments[this.segments.length - 1];
    return last?.type === 'REST' && last.reason === reason;
  }

  private emit(s: Segment): void {
    this.segments.push(s);
    this.tracker.apply(s);
  }

  private guard(): void {
    if (++this.steps > MAX_STEPS) throw new Error('planTimeline: no progress');
  }
}

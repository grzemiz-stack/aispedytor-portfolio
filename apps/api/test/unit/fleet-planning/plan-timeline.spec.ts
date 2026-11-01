/**
 * The planner: where it puts breaks and rests, the ETA, both strategies,
 * and — over hundreds of random feasible inputs — that its timeline is
 * always accepted by the validator.
 */
import { engineStart, type DriverStatusSnapshot } from '../../../src/fleet-planning/rules/driver-state';
import { planTimeline, type PlanOptions, type PlanTask } from '../../../src/fleet-planning/rules/plan-timeline';
import type { Segment } from '../../../src/fleet-planning/rules/timeline';
import { d, status, t } from '../../fixtures/driver-status';

const ORIGIN = '2026-10-07T08:00:00Z';
const MIN = 60_000;

function plan(tasks: PlanTask[], over: Partial<DriverStatusSnapshot> = {}, options: PlanOptions = {}) {
  const s = status(over);
  return planTimeline(engineStart(s, s.asOf.getTime()), tasks, options);
}
const drive = (minutes: number): PlanTask => ({ type: 'DRIVE', minutes });
const work = (minutes: number): PlanTask => ({ type: 'WORK', minutes });
const available = (minutes: number): PlanTask => ({ type: 'AVAILABILITY', minutes });
/** Segments as [type, minutes] (rests with the planner's reason). */
const shape = (segments: Segment[]) => segments.map((s) => [s.type === 'REST' ? s.reason : s.type, (s.end - s.start) / MIN]);
const codes = (list: { code: string }[]) => list.map((m) => m.code);

describe('breaks', () => {
  it('3 h of driving: nothing inserted, ETA = start + 3 h', () => {
    const r = plan([drive(180)]);
    expect([shape(r.segments), new Date(r.eta).toISOString(), codes(r.violations)]).toEqual([[['DRIVE', 180]], '2026-10-07T11:00:00.000Z', []]);
  });

  it('6 h of driving: the break exactly after 4.5 h', () => {
    expect(shape(plan([drive(360)]).segments)).toEqual([['DRIVE', 270], ['BREAK', 45], ['DRIVE', 90]]);
  });

  it('driving tasks in a row share the 4.5 h counter', () => {
    expect(shape(plan([drive(200), drive(100)]).segments)).toEqual([['DRIVE', 200], ['DRIVE', 70], ['BREAK', 45], ['DRIVE', 30]]);
  });

  it('on duty with 3 h since the break: the break comes after 1.5 h', () => {
    const shift = { onDuty: true, dailyRestEndedAt: d('2026-10-07T04:00:00Z'), drivingSinceDailyRestMinutes: 180, drivingSinceBreakMinutes: 180, workSinceBreakMinutes: 200 };
    expect(shape(plan([drive(120)], shift).segments)).toEqual([['DRIVE', 90], ['BREAK', 45], ['DRIVE', 30]]);
  });
});

describe('daily driving and daily rest', () => {
  it('standard: 9 h, then an 11 h rest', () => {
    const r = plan([drive(600)]);
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['DRIVE', 270], ['BREAK', 45], ['DRIVE', 270], ['DAILY_REST', 660], ['DRIVE', 60]], []]);
  });

  it('earliest: a 10-hour day while one is left', () => {
    const r = plan([drive(600)], {}, { strategy: 'earliest' });
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['DRIVE', 270], ['BREAK', 45], ['DRIVE', 270], ['BREAK', 45], ['DRIVE', 60]], []]);
  });

  it('earliest with both 10-hour days used: 9 h, then a reduced 9 h rest', () => {
    const r = plan([drive(600)], { extendedDrivingDaysUsed: 2 }, { strategy: 'earliest' });
    expect(shape(r.segments)).toEqual([['DRIVE', 270], ['BREAK', 45], ['DRIVE', 270], ['DAILY_REST', 540], ['DRIVE', 60]]);
  });

  it('earliest with three reduced daily rests used: the rest is 11 h', () => {
    const r = plan([drive(600)], { extendedDrivingDaysUsed: 2, reducedDailyRestsUsed: 3 }, { strategy: 'earliest' });
    expect(shape(r.segments)[3]).toEqual(['DAILY_REST', 660]);
  });

  it('earliest arrives no later than standard', () => {
    const tasks = [drive(500), work(60), drive(700), available(90), drive(400)];
    expect(plan(tasks, {}, { strategy: 'earliest' }).eta).toBeLessThanOrEqual(plan(tasks).eta);
  });
});

describe('the 24-hour window and tasks that are not split', () => {
  it('a long duty: the rest comes before a task that would end after its latest start; the task is not split', () => {
    // 08:00 + 4.5 h + 45 min + 4 h work + 30 min + 3 h waiting = 20:45; 2 h more would end after 21:00 (+13 h).
    const r = plan([drive(270), work(240), available(180), work(120)]);
    expect([shape(r.segments).slice(-2), codes(r.violations)]).toEqual([[['DAILY_REST', 660], ['WORK', 120]], []]);
  });

  it('a task that cannot fit in one duty is placed anyway and reported', () => {
    const r = plan([available(14 * 60)]);
    expect([codes(r.planNotes), shape(r.segments)]).toEqual([['TASK_CANNOT_FIT_LEGALLY'], [['AVAILABILITY', 840]]]);
  });

  it('7 h of work in one piece: placed, reported, and the validator shows the violation', () => {
    const r = plan([work(420)]);
    expect([codes(r.planNotes), codes(r.violations)]).toEqual([['TASK_CANNOT_FIT_LEGALLY'], ['WTD_BREAK_MISSING', 'WTD_BREAK_MISSING']]);
  });
});

describe('weekly limits and the weekly rest', () => {
  it('the weekly rest starts by its deadline even with driving left', () => {
    const r = plan([drive(600)], { asOf: d('2026-10-10T22:00:00Z') });
    const weekly = r.segments.find((s) => s.reason === 'WEEKLY_REST')!;
    expect([weekly.start <= t('2026-10-11T06:00:00Z'), (weekly.end - weekly.start) / MIN, codes(r.violations)]).toEqual([true, 2700, []]);
  });

  it('after a reduced weekly rest the planner takes a regular one, also in earliest', () => {
    const over = { asOf: d('2026-10-10T22:00:00Z'), weeklyRestType: 'REDUCED' as const, compensationOwedMinutes: 0 };
    const weekly = plan([drive(600)], over, { strategy: 'earliest' }).segments.find((s) => s.reason === 'WEEKLY_REST')!;
    expect((weekly.end - weekly.start) / MIN).toBe(2700);
  });

  it('earliest after a regular weekly rest: a reduced 24 h one, with the compensation owed', () => {
    const r = plan([drive(600)], { asOf: d('2026-10-10T22:00:00Z') }, { strategy: 'earliest' });
    const weekly = r.segments.find((s) => s.reason === 'WEEKLY_REST')!;
    expect([(weekly.end - weekly.start) / MIN, r.tracker.compensationOwedMinutes(), codes(r.violations)]).toEqual([1440, 1260, []]);
  });

  it('56 h reached on Saturday: the rest lasts at least until Monday 00:00', () => {
    const over = { asOf: d('2026-10-10T10:00:00Z'), weeklyRestEndedAt: d('2026-10-07T06:00:00Z'), drivingThisWeekMinutes: 3300, drivingLastWeekMinutes: 1000 };
    const r = plan([drive(120)], over);
    const weekly = r.segments.find((s) => s.reason === 'WEEKLY_REST')!;
    expect([shape(r.segments), weekly.end >= t('2026-10-12T00:00:00Z'), codes(r.violations)]).toEqual([[['DRIVE', 60], ['WEEKLY_REST', 2700], ['DRIVE', 60]], true, []]);
  });

  it('56 h reached on Thursday: one weekly rest until Monday 00:00 (longer than 45 h)', () => {
    const over = { asOf: d('2026-10-08T10:00:00Z'), weeklyRestEndedAt: d('2026-10-07T06:00:00Z'), drivingThisWeekMinutes: 3300, drivingLastWeekMinutes: 1000 };
    const r = plan([drive(120)], over);
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['DRIVE', 60], ['WEEKLY_REST', (t('2026-10-12T00:00:00Z') - t('2026-10-08T11:00:00Z')) / MIN], ['DRIVE', 60]], []]);
  });

  it('a daily rest that would run past the weekly deadline: the weekly rest is taken instead', () => {
    // Saturday 13:00, 9 h of driving end at 22:45; an 11 h rest would end after Sunday 06:00.
    const r = plan([drive(540), drive(60)], { asOf: d('2026-10-10T13:00:00Z') });
    const rests = r.segments.filter((x) => x.type === 'REST').map((x) => x.reason);
    expect([rests, codes(r.violations)]).toEqual([['BREAK', 'WEEKLY_REST'], []]);
  });

  it('a start that is not a whole minute: the weekly rest still starts by its deadline', () => {
    const r = plan([drive(600)], { asOf: d('2026-10-10T22:00:30Z') });
    const weekly = r.segments.find((x) => x.reason === 'WEEKLY_REST')!;
    expect([weekly.start <= t('2026-10-11T06:00:00Z'), codes(r.violations)]).toEqual([true, []]);
  });

  it('90 h in two weeks reached: no driving until the new week', () => {
    const over = { asOf: d('2026-10-10T10:00:00Z'), weeklyRestEndedAt: d('2026-10-07T06:00:00Z'), drivingThisWeekMinutes: 2340, drivingLastWeekMinutes: 3000 };
    const r = plan([drive(120)], over);
    const after = r.segments.filter((s) => s.type === 'DRIVE')[1];
    expect([after.start >= t('2026-10-12T00:00:00Z'), codes(r.violations)]).toEqual([true, []]);
  });
});

describe('compensation', () => {
  it('owed with a late deadline: attached to the weekly rest', () => {
    const r = plan([drive(600)], { asOf: d('2026-10-10T22:00:00Z'), compensationOwedMinutes: 600, compensationDueBy: d('2026-10-26T00:00:00Z') });
    const weekly = r.segments.find((s) => s.reason === 'WEEKLY_REST')!;
    expect([weekly.compensationMinutes, (weekly.end - weekly.start) / MIN, codes(r.violations)]).toEqual([600, 3300, []]);
  });

  it('owed with a deadline before the next weekly rest: attached to the daily rest', () => {
    const r = plan([drive(600)], { compensationOwedMinutes: 600, compensationDueBy: d('2026-10-09T00:00:00Z') });
    const daily = r.segments.find((s) => s.reason === 'DAILY_REST')!;
    expect([daily.compensationMinutes, (daily.end - daily.start) / MIN, codes(r.violations)]).toEqual([600, 1260, []]);
  });
});

describe('working time (2002/15)', () => {
  it('loading 2 h then driving: a 30 min break at 6 h of work, then the split break completes', () => {
    const r = plan([work(120), drive(300)]);
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['WORK', 120], ['DRIVE', 240], ['BREAK', 30], ['DRIVE', 30], ['BREAK', 30], ['DRIVE', 30]], []]);
  });

  it('a work task that would break the 6 h run waits for a break', () => {
    const r = plan([work(300), work(120)]);
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['WORK', 300], ['BREAK', 30], ['WORK', 120]], []]);
  });
});

describe('start', () => {
  it('unavailable until Friday: the plan waits', () => {
    const r = plan([drive(60)], { unavailableUntil: d('2026-10-09T00:00:00Z') });
    expect(shape(r.segments)).toEqual([['WAIT', (t('2026-10-09T00:00:00Z') - t(ORIGIN)) / MIN], ['DRIVE', 60]]);
  });

  it('a requested later start', () => {
    const r = plan([drive(60)], {}, { startAt: t('2026-10-07T10:00:00Z') });
    expect(shape(r.segments)).toEqual([['WAIT', 120], ['DRIVE', 60]]);
  });

  it('a start at a time that is not a whole minute does not create extra breaks', () => {
    const r = plan([drive(600)], { asOf: d('2026-10-07T08:00:30Z') });
    expect([shape(r.segments), codes(r.violations)]).toEqual([[['DRIVE', 270], ['BREAK', 45], ['DRIVE', 270], ['DAILY_REST', 660], ['DRIVE', 60]], []]);
  });
});

describe('properties over random feasible inputs (seeded)', () => {
  /** mulberry32: small deterministic PRNG. */
  function rng(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const CASES = 3000;

  function randomCase(seed: number) {
    const r = rng(seed);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const lastWeek = int(0, 3360);
    const thisWeek = int(0, Math.min(3000, 5400 - lastWeek - 60));
    const onDuty = r() < 0.4;
    const asOf = t('2026-10-05T06:00:00Z') + int(0, 4 * 24 * 60) * MIN;
    const over: Partial<DriverStatusSnapshot> = {
      asOf: new Date(asOf),
      weeklyRestEndedAt: d('2026-10-05T06:00:00Z'),
      weeklyRestType: r() < 0.5 ? 'REGULAR' : 'REDUCED',
      drivingThisWeekMinutes: thisWeek,
      drivingLastWeekMinutes: lastWeek,
      extendedDrivingDaysUsed: int(0, 2),
      reducedDailyRestsUsed: int(0, 3),
      ...(r() < 0.3 ? { compensationOwedMinutes: int(60, 1260), compensationDueBy: new Date(asOf + int(3, 20) * 24 * 60 * MIN) } : {}),
      ...(onDuty
        ? (() => {
            const since = int(0, 240);
            const driving = int(0, 400);
            const sinceBreak = int(0, Math.min(200, driving));
            return { onDuty: true, dailyRestEndedAt: new Date(asOf - since * MIN), drivingSinceDailyRestMinutes: Math.min(driving, since), drivingSinceBreakMinutes: Math.min(sinceBreak, since), workSinceBreakMinutes: Math.min(sinceBreak, since) };
          })()
        : {}),
    };
    const tasks: PlanTask[] = Array.from({ length: int(1, 12) }, () => {
      const k = r();
      if (k < 0.6) return drive(int(10, 900));
      if (k < 0.85) return work(int(5, 300));
      return available(int(5, 240));
    });
    const options: PlanOptions = { strategy: r() < 0.5 ? 'standard' : 'earliest', restsAbroad: r() < 0.3 };
    // Unknown values (docs/decisions.md §11), drawn last so the earlier draws — and the cases — stay the same.
    if (r() < 0.2) over.weeklyRestType = null;
    if (r() < 0.2) over.lastHomeRestEndedAt = null;
    if (r() < 0.2) Object.assign(over, { compensationOwedMinutes: null, compensationDueBy: null });
    // A provider that leaves out the deadline of one reduced rest (the engine derives the earliest one).
    if (r() < 0.3 && over.compensationOwedMinutes && over.weeklyRestType === 'REDUCED') over.compensationDueBy = null;
    // On duty unknown: only for a resting driver, so the case stays feasible.
    if (r() < 0.2 && !over.dailyRestEndedAt) over.onDuty = null;
    return { over, tasks, options };
  }

  it(`${CASES} cases: the validator accepts every planned timeline`, () => {
    const failures: unknown[] = [];
    for (let seed = 1; seed <= CASES; seed++) {
      const { over, tasks, options } = randomCase(seed);
      const r = plan(tasks, over, options);
      if (r.violations.length > 0) failures.push({ seed, violations: r.violations.map((v) => [v.code, v.params]) });
    }
    expect(failures).toEqual([]);
  });

  it('driving minutes in = out; other tasks whole and in order; the timeline is continuous; ETA is its end', () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const { over, tasks, options } = randomCase(seed);
      const r = plan(tasks, over, options);
      tasks.forEach((task, i) => {
        const parts = r.segments.filter((s) => s.taskIndex === i);
        const minutes = parts.reduce((m, s) => m + (s.end - s.start) / MIN, 0);
        expect([seed, i, minutes, task.type === 'DRIVE' || parts.length === 1]).toEqual([seed, i, task.minutes, true]);
      });
      const order = r.segments.filter((s) => s.taskIndex != null).map((s) => s.taskIndex!);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      r.segments.forEach((s, i) => {
        if (i > 0) expect(s.start).toBe(r.segments[i - 1].end);
      });
      expect(r.eta).toBe(r.segments[r.segments.length - 1].end);
    }
  });

  it('deterministic, and the input is not changed', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { over, tasks, options } = randomCase(seed);
      const frozen = Object.freeze(tasks.map((x) => Object.freeze({ ...x })));
      const a = plan(frozen as PlanTask[], over, options);
      const b = plan(frozen as PlanTask[], over, options);
      expect(a.segments).toEqual(b.segments);
    }
  });
});

/**
 * The validator on hand-built timelines: every rule of 561/2006 and
 * 2002/15 the module checks, on the hard cases (boundaries, splits, week
 * edges, exceptions). Base status: Wednesday 7 Oct 2026 08:00 UTC, not on
 * duty, regular weekly rest at home ended Monday 5 Oct 06:00; 15 h driven
 * this week, 40 h last week; one 10-hour day and one reduced daily rest used.
 */
import { checkTimeline } from '../../../src/fleet-planning/rules/check-timeline';
import { engineStart, type DriverStatusSnapshot } from '../../../src/fleet-planning/rules/driver-state';
import { TimelineError } from '../../../src/fleet-planning/rules/timeline';
import { weekIndex } from '../../../src/fleet-planning/rules/fixed-week';
import { PLAN_MESSAGE_CODES } from '../../../src/common/plan-messages';
import { d, status, t } from '../../fixtures/driver-status';
import { from, type TimelineBuilder } from '../../fixtures/timeline-builder';

const ORIGIN = '2026-10-07T08:00:00Z';

function run(b: TimelineBuilder, over: Partial<DriverStatusSnapshot> = {}) {
  const s = status(over);
  return checkTimeline(engineStart(s, s.asOf.getTime()), b.segments);
}
const codes = (list: { code: string }[]) => list.map((m) => m.code);
const violations = (b: TimelineBuilder, over: Partial<DriverStatusSnapshot> = {}) => codes(run(b, over).violations);
const at = (r: ReturnType<typeof run>, code: string) => r.violations.find((m) => m.code === code)?.params?.at;

describe('A. Breaks (561 art. 7)', () => {
  it('4.5 h of driving, then 45 min, then more driving: legal', () => {
    expect(violations(from(ORIGIN).drive(270).rest(45).drive(270))).toEqual([]);
  });

  it('one minute over 4.5 h: BREAK_MISSING at the 4.5 h mark', () => {
    const r = run(from(ORIGIN).drive(271));
    expect([codes(r.violations), at(r, 'BREAK_MISSING')]).toEqual([['BREAK_MISSING'], '2026-10-07T12:30:00.000Z']);
  });

  it('other work does not reset the driving counter', () => {
    expect(violations(from(ORIGIN).drive(180).work(60).drive(91))).toEqual(['BREAK_MISSING']);
  });

  it('a period of availability is not a break', () => {
    expect(violations(from(ORIGIN).drive(200).available(45).drive(71))).toEqual(['BREAK_MISSING']);
  });

  it('split break 15 + 30: legal', () => {
    expect(violations(from(ORIGIN).drive(120).rest(15).drive(150).rest(30).drive(200))).toEqual([]);
  });

  it('split break 30 + 15 (wrong order): the 15 does not complete it', () => {
    expect(violations(from(ORIGIN).drive(120).rest(30).drive(150).rest(15).drive(10))).toEqual(['BREAK_MISSING']);
  });

  it('15 + 15 + 30: the first 15 and the 30 make the break', () => {
    expect(violations(from(ORIGIN).drive(100).rest(15).drive(100).rest(15).drive(70).rest(30).drive(200))).toEqual([]);
  });

  it('a 44-minute break does not count', () => {
    expect(violations(from(ORIGIN).drive(270).rest(44).drive(1))).toEqual(['BREAK_MISSING']);
  });

  it('a daily rest resets the counter', () => {
    expect(violations(from(ORIGIN).drive(270).rest(660).drive(270))).toEqual([]);
  });

  it('on duty with 3 h since the break: the break is due after 1.5 h more', () => {
    const shift = { onDuty: true, dailyRestEndedAt: d('2026-10-07T04:00:00Z'), drivingSinceDailyRestMinutes: 180, drivingSinceBreakMinutes: 180, workSinceBreakMinutes: 200 };
    expect(violations(from(ORIGIN).drive(90), shift)).toEqual([]);
    expect(violations(from(ORIGIN).drive(91), shift)).toEqual(['BREAK_MISSING']);
  });

  it('gaps in the timeline count as rest', () => {
    const b = from(ORIGIN).drive(270);
    b.cursor += 45 * 60_000;
    expect(violations(b.drive(100))).toEqual([]);
  });
});

describe('B. Daily driving (561 art. 6(1))', () => {
  const nineHours = () => from(ORIGIN).drive(270).rest(45).drive(270);

  it('9 h: legal', () => {
    expect(violations(nineHours())).toEqual([]);
  });

  it('over 9 h with a 10-hour day left (1 of 2 used): legal, the day is counted', () => {
    const r = run(nineHours().rest(45).drive(1));
    expect([codes(r.violations), r.tracker.extendedDaysInWeek(weekIndex(t(ORIGIN)))]).toEqual([[], 2]);
  });

  it('over 9 h with both 10-hour days used: DAILY_DRIVING_EXCEEDED (9 h)', () => {
    const r = run(nineHours().rest(45).drive(1), { extendedDrivingDaysUsed: 2 });
    expect([codes(r.violations), r.violations[0].params?.limitMinutes]).toEqual([['DAILY_DRIVING_EXCEEDED'], 540]);
  });

  it('10 h: legal; one minute more: DAILY_DRIVING_EXCEEDED (10 h)', () => {
    const tenHours = () => nineHours().rest(45).drive(60);
    expect(violations(tenHours())).toEqual([]);
    const r = run(tenHours().drive(1));
    expect([codes(r.violations), r.violations[0].params?.limitMinutes]).toEqual([['DAILY_DRIVING_EXCEEDED'], 600]);
  });

  it('the 10-hour days start again on Monday 00:00 UTC', () => {
    // Friday, both used; a rest until Monday 06:00, then 10 h on Monday.
    const b = from('2026-10-09T18:00:00Z').rest(60 * 60).drive(270).rest(45).drive(270).rest(45).drive(60);
    expect(violations(b, { asOf: d('2026-10-09T18:00:00Z'), extendedDrivingDaysUsed: 2 })).toEqual([]);
  });

  it('a duty period across midnight is one daily driving period', () => {
    const b = from('2026-10-07T20:00:00Z').drive(270).rest(45).drive(270).rest(45).drive(1);
    expect(violations(b, { asOf: d('2026-10-07T20:00:00Z'), extendedDrivingDaysUsed: 2 })).toEqual(['DAILY_DRIVING_EXCEEDED']);
  });
});

describe('C. Daily rest and the 24-hour window (561 art. 8(2), (4))', () => {
  it('a regular 11 h rest after the day: legal, no reduced rest used', () => {
    const r = run(from(ORIGIN).drive(270).rest(45).drive(270).rest(660).drive(60));
    expect([codes(r.violations), r.tracker.reducedDailyRestsUsed]).toEqual([[], 1]);
  });

  it('little driving, long duty: the window forces the rest (start by +15 h with a reduced rest left)', () => {
    const b = from(ORIGIN).drive(270).rest(45).work(240).rest(30).available(300).work(30);
    const r = run(b);
    expect([codes(r.violations), at(r, 'DAILY_REST_LATE')]).toEqual([['DAILY_REST_LATE'], '2026-10-07T23:00:00.000Z']);
  });

  it('no reduced rest left: the rest must start by +13 h', () => {
    const r = run(from(ORIGIN).drive(270).rest(45).work(240).rest(30).available(200), { reducedDailyRestsUsed: 3 });
    expect(at(r, 'DAILY_REST_LATE')).toBe('2026-10-07T21:00:00.000Z');
  });

  it('activity ending exactly at the latest start: legal', () => {
    expect(violations(from(ORIGIN).drive(270).rest(45).work(240).rest(30).available(315))).toEqual([]);
  });

  it('a reduced 9 h rest counts as reduced', () => {
    const r = run(from(ORIGIN).drive(270).rest(540).drive(60));
    expect([codes(r.violations), r.tracker.reducedDailyRestsUsed]).toEqual([[], 2]);
  });

  it('10 h 59 min is a reduced rest', () => {
    expect(run(from(ORIGIN).drive(270).rest(659).drive(60)).tracker.reducedDailyRestsUsed).toBe(2);
  });

  it('a fourth reduced rest between weekly rests: REDUCED_DAILY_RESTS_EXCEEDED', () => {
    expect(violations(from(ORIGIN).drive(270).rest(540).drive(60), { reducedDailyRestsUsed: 3 })).toEqual(['REDUCED_DAILY_RESTS_EXCEEDED']);
  });

  it('unknown reduced rests count as all used: the next reduced one is a violation', () => {
    expect(violations(from(ORIGIN).drive(270).rest(540).drive(60), { reducedDailyRestsUsed: null })).toEqual(['REDUCED_DAILY_RESTS_EXCEEDED']);
  });

  it('split rest 3 h + 9 h is regular', () => {
    const r = run(from(ORIGIN).drive(270).rest(180).drive(270).rest(540).drive(60));
    expect([codes(r.violations), r.tracker.reducedDailyRestsUsed]).toEqual([[], 1]);
  });

  it('9 h + 3 h (wrong order): the 9 h is a reduced rest', () => {
    expect(run(from(ORIGIN).drive(270).rest(540).drive(60).rest(180)).tracker.reducedDailyRestsUsed).toBe(2);
  });
});

describe('D. Weekly and fortnightly driving (561 art. 6(2)–(3))', () => {
  it('56 h in the week: legal; one minute more: WEEKLY_DRIVING_EXCEEDED', () => {
    const base = { drivingThisWeekMinutes: 3300, drivingLastWeekMinutes: 1000 };
    expect(violations(from(ORIGIN).drive(60), base)).toEqual([]);
    expect(violations(from(ORIGIN).drive(61), base)).toEqual(['WEEKLY_DRIVING_EXCEEDED']);
  });

  it('driving across Sunday 24:00 is counted in both weeks', () => {
    // 55 h this week; 1 h before midnight reaches exactly 56 h, 1 h after belongs to the new week.
    const over = { asOf: d('2026-10-11T23:00:00Z'), weeklyRestEndedAt: d('2026-10-07T06:00:00Z'), drivingThisWeekMinutes: 3300, drivingLastWeekMinutes: 1000 };
    const r = run(from('2026-10-11T23:00:00Z').drive(120), over);
    expect([codes(r.violations), r.tracker.drivingInWeek(weekIndex(t('2026-10-12T00:00:00Z')))]).toEqual([[], 60]);
  });

  it('90 h in two weeks: 50 h last week leaves 40 h this week', () => {
    const base = { drivingLastWeekMinutes: 3000, drivingThisWeekMinutes: 2340 };
    expect(violations(from(ORIGIN).drive(60), base)).toEqual([]);
    expect(violations(from(ORIGIN).drive(61), base)).toEqual(['FORTNIGHT_DRIVING_EXCEEDED']);
  });

  it('a status from last week: its "this week" is counted as last week', () => {
    const over = { asOf: d('2026-10-09T18:00:00Z'), weeklyRestEndedAt: d('2026-10-12T06:00:00Z'), drivingThisWeekMinutes: 3360, drivingLastWeekMinutes: 0 };
    const r = run(from('2026-10-12T06:00:00Z').drive(60), over);
    expect(r.tracker.drivingInWeek(weekIndex(t('2026-10-05T12:00:00Z')))).toBe(3360);
  });

  it('a status exactly at 56 h, then one minute of driving: WEEKLY_DRIVING_EXCEEDED', () => {
    expect(violations(from(ORIGIN).drive(1), { drivingThisWeekMinutes: 3360, drivingLastWeekMinutes: 0 })).toEqual(['WEEKLY_DRIVING_EXCEEDED']);
  });

  it('a status exactly at 90 h in two weeks, then one minute: FORTNIGHT_DRIVING_EXCEEDED', () => {
    expect(violations(from(ORIGIN).drive(1), { drivingThisWeekMinutes: 2400, drivingLastWeekMinutes: 3000 })).toEqual(['FORTNIGHT_DRIVING_EXCEEDED']);
  });

  it('a status already over 56 h is reported, not hidden', () => {
    expect(violations(from(ORIGIN).drive(10), { drivingThisWeekMinutes: 3400, drivingLastWeekMinutes: 0 })).toEqual(['WEEKLY_DRIVING_EXCEEDED']);
  });
});

describe('E. Weekly rest (561 art. 8(6)–(8))', () => {
  const lateStatus = { asOf: d('2026-10-10T20:00:00Z') };

  it('the weekly rest must start within six 24-hour periods: driving after the deadline is WEEKLY_REST_LATE', () => {
    const r = run(from('2026-10-10T20:00:00Z').rest(12 * 60).drive(60), lateStatus);
    expect([codes(r.violations), at(r, 'WEEKLY_REST_LATE')]).toEqual([['WEEKLY_REST_LATE'], '2026-10-11T06:00:00.000Z']);
  });

  it('a 45 h rest started before the deadline: legal (accommodation away from home noted)', () => {
    const r = run(from('2026-10-10T20:00:00Z').rest(45 * 60).drive(60), lateStatus);
    expect([codes(r.violations), codes(r.notices)]).toEqual([[], ['WEEKLY_REST_ACCOMMODATION_REQUIRED']]);
  });

  it('a reduced weekly rest creates compensation owed by the end of the third week after', () => {
    const r = run(from(ORIGIN).drive(270).rest(24 * 60).drive(60));
    expect([codes(r.violations), r.tracker.compensation.map((c) => [c.minutes, new Date(c.dueBy).toISOString()])])
      .toEqual([[], [[1260, '2026-11-02T00:00:00.000Z']]]);
  });

  it('44 h 59 min is a reduced weekly rest (1 min owed)', () => {
    expect(run(from(ORIGIN).drive(60).rest(2699)).tracker.compensation[0].minutes).toBe(1);
  });

  it('after a reduced weekly rest the next must be regular: CONSECUTIVE_REDUCED_WEEKLY_RESTS', () => {
    const over = { weeklyRestType: 'REDUCED' as const, compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z') };
    expect(violations(from(ORIGIN).drive(60).rest(24 * 60), over)).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
  });

  it('compensation attached en bloc to a rest of at least 9 h before the deadline: paid', () => {
    const over = { compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z') };
    const r = run(from(ORIGIN).drive(270).rest(660 + 1260, { compensationMinutes: 1260 }).drive(60), over);
    expect([codes(r.violations), r.tracker.compensationOwedMinutes()]).toEqual([[], 0]);
  });

  it('compensation not taken by its deadline: COMPENSATION_OVERDUE', () => {
    const over = { compensationOwedMinutes: 600, compensationDueBy: d('2026-10-07T12:00:00Z') };
    const r = run(from(ORIGIN).drive(270).rest(45).drive(60), over);
    expect([codes(r.violations), at(r, 'COMPENSATION_OVERDUE')]).toEqual([['COMPENSATION_OVERDUE'], '2026-10-07T12:00:00.000Z']);
  });

  it('compensation opening a long rest: taken by start + its length, even if the rest ends after the deadline', () => {
    const over = { compensationOwedMinutes: 600, compensationDueBy: d('2026-10-07T22:00:00Z') };
    // rest from 12:30 with 600 min compensation: taken by 22:30 — 30 min late; from 12:00 it is on time.
    expect(violations(from(ORIGIN).drive(270).rest(600 + 2700, { compensationMinutes: 600 }), over)).toEqual(['COMPENSATION_OVERDUE']);
    expect(violations(from(ORIGIN).drive(240).rest(600 + 2700, { compensationMinutes: 600 }), over)).toEqual([]);
  });

  it('compensation in parts does not pay it (en bloc only)', () => {
    const over = { compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z') };
    expect(run(from(ORIGIN).drive(270).rest(660 + 600, { compensationMinutes: 600 }), over).tracker.compensationOwedMinutes()).toBe(1260);
  });

  it('compensation attached to a rest under 9 h: COMPENSATION_INVALID', () => {
    const over = { compensationOwedMinutes: 600, compensationDueBy: d('2026-10-26T00:00:00Z') };
    expect(violations(from(ORIGIN).drive(270).rest(480 + 600, { compensationMinutes: 600 }), over)).toEqual(['COMPENSATION_INVALID']);
  });

  describe('two consecutive reduced weekly rests abroad (art. 8(6) third subparagraph)', () => {
    const history = (r2: 'REGULAR' | 'REDUCED' = 'REGULAR', r3: 'REGULAR' | 'REDUCED' = 'REGULAR', r3End = '2026-09-21T06:00:00Z') => ({
      weeklyRestType: 'REDUCED' as const,
      weeklyRestAbroad: true,
      weeklyRestAtHome: false,
      compensationOwedMinutes: 1260,
      compensationDueBy: d('2026-10-26T00:00:00Z'),
      recentWeeklyRests: [
        { type: 'REDUCED' as const, endedAt: d('2026-10-05T06:00:00Z'), abroad: true },
        { type: r2, endedAt: d('2026-09-28T06:00:00Z'), abroad: false },
        { type: r3, endedAt: d(r3End), abroad: false },
      ],
    });
    const second = () => from(ORIGIN).drive(270).rest(24 * 60, { abroad: true });

    it('both abroad, the two before regular, within four weeks: allowed (notice), return home within 3 weeks', () => {
      const r = run(second(), history());
      expect([codes(r.violations), codes(r.notices), r.tracker.twoConsecutiveReduced]).toEqual([[], ['WEEKLY_REST_EXCEPTION_APPLIED'], true]);
    });

    it('the first one at home country (not abroad), the second abroad: violation', () => {
      const firstAtHome = { ...history(), weeklyRestAbroad: false, recentWeeklyRests: history().recentWeeklyRests.map((r, i) => (i === 0 ? { ...r, abroad: false } : r)) };
      expect(violations(second(), firstAtHome)).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
    });

    it('the second one at home country (not abroad): violation', () => {
      expect(violations(from(ORIGIN).drive(270).rest(24 * 60), history())).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
    });

    it('fewer than two regular rests in the four: violation', () => {
      expect(violations(second(), history('REDUCED'))).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
      expect(violations(second(), history('REGULAR', 'REDUCED'))).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
    });

    it('the four rests spread over more than four weeks: violation', () => {
      expect(violations(second(), history('REGULAR', 'REGULAR', '2026-09-08T06:00:00Z'))).toEqual(['CONSECUTIVE_REDUCED_WEEKLY_RESTS']);
    });

    it('no list of recent weekly rests: not applied, and the result says it could not be checked', () => {
      const r = run(second(), { ...history(), recentWeeklyRests: null });
      expect([codes(r.violations), codes(r.notices)]).toEqual([['CONSECUTIVE_REDUCED_WEEKLY_RESTS'], ['WEEKLY_REST_EXCEPTION_UNVERIFIABLE']]);
    });

    it('the next weekly rest must be preceded by both compensations', () => {
      const b = second().drive(270).rest(660).drive(270).rest(45 * 60, { abroad: true });
      expect(violations(b, history())).toEqual(['COMPENSATION_NOT_BEFORE_WEEKLY_REST']);
    });
  });

  describe('where the weekly rest is taken (art. 8(8))', () => {
    it('regular weekly rest in the cab: WEEKLY_REST_IN_CAB', () => {
      expect(violations(from(ORIGIN).drive(60).rest(45 * 60, { inCab: true }))).toEqual(['WEEKLY_REST_IN_CAB']);
    });

    it('regular weekly rest away from home, not in the cab: legal, accommodation noted', () => {
      const r = run(from(ORIGIN).drive(60).rest(45 * 60));
      expect([codes(r.violations), codes(r.notices)]).toEqual([[], ['WEEKLY_REST_ACCOMMODATION_REQUIRED']]);
    });

    it('regular weekly rest at home: nothing to note', () => {
      const r = run(from(ORIGIN).drive(60).rest(45 * 60, { place: 'HOME' }));
      expect([codes(r.violations), codes(r.notices)]).toEqual([[], []]);
    });

    it('reduced weekly rest in the cab: allowed', () => {
      const r = run(from(ORIGIN).drive(60).rest(24 * 60, { inCab: true }));
      expect([codes(r.violations), codes(r.notices)]).toEqual([[], []]);
    });

    it('a reduced rest with compensation, over 45 h in total, in the cab: WEEKLY_REST_IN_CAB', () => {
      const over = { compensationOwedMinutes: 1320, compensationDueBy: d('2026-10-26T00:00:00Z') };
      expect(violations(from(ORIGIN).drive(60).rest(24 * 60 + 1320, { inCab: true, compensationMinutes: 1320 }), over)).toEqual(['WEEKLY_REST_IN_CAB']);
    });

    it('a reduced rest with compensation, exactly 45 h in total, in the cab: allowed (over 45 h only)', () => {
      const over = { compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z') };
      expect(violations(from(ORIGIN).drive(60).rest(24 * 60 + 1260, { inCab: true, compensationMinutes: 1260 }), over)).toEqual([]);
    });
  });
});

describe('F. Return home (561 art. 8(8a))', () => {
  it('past 4 weeks without a home rest: HOME_RETURN_LATE is a warning, not a violation', () => {
    const r = run(from(ORIGIN).drive(270).rest(660).drive(60), { lastHomeRestEndedAt: d('2026-09-09T06:00:00Z') });
    expect([codes(r.violations), codes(r.warnings), r.warnings[0].params?.at]).toEqual([[], ['HOME_RETURN_LATE'], '2026-10-07T06:00:00.000Z']);
  });

  it('the driver chose to stay away: a notice instead of the warning', () => {
    const r = run(from(ORIGIN).drive(270).rest(660).drive(60), { lastHomeRestEndedAt: d('2026-09-09T06:00:00Z'), driverChoseToStayAway: true });
    expect([codes(r.warnings), codes(r.notices)]).toEqual([[], ['HOME_RETURN_DECLINED']]);
  });

  it('a home rest started before the deadline: no warning, the period starts again', () => {
    const r = run(from(ORIGIN).drive(60).rest(45 * 60, { place: 'HOME' }).drive(60), { lastHomeRestEndedAt: d('2026-09-10T06:00:00Z') });
    expect([codes(r.warnings), new Date(r.tracker.homeRestDeadline()).toISOString()]).toEqual([[], '2026-11-06T06:00:00.000Z']);
  });

  it('a home rest started after the deadline: warning', () => {
    const r = run(from(ORIGIN).rest(45 * 60, { place: 'HOME' }), { lastHomeRestEndedAt: d('2026-09-01T06:00:00Z'), asOf: d('2026-10-07T08:00:00Z') });
    expect(codes(r.warnings)).toEqual(['HOME_RETURN_LATE']);
  });

  it('after two consecutive reduced weekly rests the period is 3 weeks', () => {
    const over = {
      weeklyRestType: 'REDUCED' as const,
      compensationOwedMinutes: 1260,
      compensationDueBy: d('2026-10-26T00:00:00Z'),
      lastHomeRestEndedAt: d('2026-09-20T06:00:00Z'),
      recentWeeklyRests: [
        { type: 'REDUCED' as const, endedAt: d('2026-10-05T06:00:00Z'), abroad: true },
        { type: 'REDUCED' as const, endedAt: d('2026-09-28T06:00:00Z'), abroad: true },
        { type: 'REGULAR' as const, endedAt: d('2026-09-20T06:00:00Z'), abroad: false },
      ],
    };
    expect(new Date(run(from(ORIGIN).drive(10), over).tracker.homeRestDeadline()).toISOString()).toBe('2026-10-11T06:00:00.000Z');
  });

  it('a reduced last weekly rest with unknown history: the 3-week period is assumed, said so', () => {
    const over = { weeklyRestType: 'REDUCED' as const, compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z'), lastHomeRestEndedAt: d('2026-09-20T06:00:00Z') };
    const r = run(from(ORIGIN).drive(10), over);
    expect([new Date(r.tracker.homeRestDeadline()).toISOString(), codes(r.notices)]).toEqual(['2026-10-11T06:00:00.000Z', ['DRIVER_STATE_ASSUMED']]);
  });

  it('last rest at home unknown: HOME_RETURN_LATE from the start, at asOf', () => {
    const r = run(from(ORIGIN).drive(60), { lastHomeRestEndedAt: null });
    expect([codes(r.violations), codes(r.warnings), r.warnings[0].params?.at]).toEqual([[], ['HOME_RETURN_LATE'], '2026-10-07T08:00:00.000Z']);
  });

  it('last rest at home unknown, the driver chose to stay away: the notice instead', () => {
    const r = run(from(ORIGIN).drive(60), { lastHomeRestEndedAt: null, driverChoseToStayAway: true });
    expect([codes(r.warnings), codes(r.notices)]).toEqual([[], ['DRIVER_STATE_ASSUMED', 'HOME_RETURN_DECLINED']]);
  });

  it('last rest at home unknown, a rest at home on the timeline: the period starts from it, no second warning', () => {
    const r = run(from(ORIGIN).drive(60).rest(45 * 60, { place: 'HOME' }).drive(60), { lastHomeRestEndedAt: null });
    expect([codes(r.warnings), new Date(r.tracker.homeRestDeadline()).toISOString()]).toEqual([['HOME_RETURN_LATE'], '2026-11-06T06:00:00.000Z']);
  });

  it('last rest at home unknown with a reduced last weekly rest: no 3-week assumption on top', () => {
    const r = run(from(ORIGIN).drive(10), { lastHomeRestEndedAt: null, weeklyRestType: 'REDUCED', compensationOwedMinutes: 0 });
    const assumedFields = r.notices.filter((m) => m.code === 'DRIVER_STATE_ASSUMED').map((m) => m.params?.field);
    expect([new Date(r.tracker.homeRestDeadline()).toISOString(), assumedFields]).toEqual(['2026-10-07T08:00:00.000Z', ['lastHomeRestEndedAt']]);
  });

  it('the annulled 8-week vehicle return is not enforced: no such code exists', () => {
    expect(PLAN_MESSAGE_CODES.filter((c) => /VEHICLE_RETURN|EIGHT_WEEK/.test(c))).toEqual([]);
  });
});

describe('G. Working time breaks (2002/15 art. 5)', () => {
  it('over 6 h of work without a break', () => {
    const r = run(from(ORIGIN).work(361));
    expect(r.violations.map((m) => m.params?.rule)).toEqual(['CONSECUTIVE', 'OVER_6H']);
  });

  it('the 45-min driving break also satisfies the working-time rule', () => {
    expect(violations(from(ORIGIN).drive(270).rest(45).drive(200).work(100))).toEqual([]);
  });

  it('loading 2 h + driving 4 h 1 min: a break is due at 6 h of work, before the driving limit', () => {
    const r = run(from(ORIGIN).work(120).drive(241));
    expect(r.violations.map((m) => [m.code, m.params?.rule])).toEqual([['WTD_BREAK_MISSING', 'CONSECUTIVE'], ['WTD_BREAK_MISSING', 'OVER_6H']]);
  });

  it('exactly 6 h of work, then more without a break: both 6 h rules', () => {
    const r = run(from(ORIGIN).work(360).work(30));
    expect(r.violations.map((m) => [m.code, m.params?.rule])).toEqual([['WTD_BREAK_MISSING', 'CONSECUTIVE'], ['WTD_BREAK_MISSING', 'OVER_6H']]);
  });

  it('exactly 9 h of work with only 30 min of breaks, then more: OVER_9H', () => {
    const r = run(from(ORIGIN).drive(270).rest(30).work(270).work(10));
    expect(r.violations.map((m) => m.params?.rule)).toEqual(['OVER_9H']);
  });

  it('exactly 6 h and exactly 9 h are still legal (the limits are "more than")', () => {
    expect([violations(from(ORIGIN).work(360)), violations(from(ORIGIN).drive(270).rest(30).work(270))]).toEqual([[], []]);
  });

  it('over 9 h of work with only 30 min of breaks: OVER_9H', () => {
    const r = run(from(ORIGIN).drive(270).rest(30).work(300));
    expect(r.violations.map((m) => m.params?.rule)).toEqual(['OVER_9H']);
  });

  it('availability is not work, and not a break', () => {
    expect(violations(from(ORIGIN).work(300).available(120).work(60))).toEqual([]);
    expect(run(from(ORIGIN).work(300).available(120).work(61)).violations.map((m) => m.params?.rule)).toEqual(['CONSECUTIVE', 'OVER_6H']);
  });

  it('a 15-min part interrupts the 6 h run but does not make the 30 or 45 min totals', () => {
    expect(run(from(ORIGIN).work(300).rest(15).work(300)).violations.map((m) => m.params?.rule)).toEqual(['OVER_6H', 'OVER_9H']);
  });
});

describe('the timeline itself', () => {
  it('overlapping segments are refused', () => {
    const b = from(ORIGIN).drive(60);
    b.cursor -= 30 * 60_000;
    expect(() => run(b.drive(60))).toThrow(TimelineError);
  });

  it('a segment before the origin is refused', () => {
    expect(() => run(from('2026-10-07T07:00:00Z').drive(60))).toThrow(TimelineError);
  });

  it('a running weekly rest is extended by a rest at the start, not counted as a second one', () => {
    const over = { asOf: d('2026-10-05T06:00:00Z') };
    const r = run(from('2026-10-05T06:00:00Z').rest(30 * 60).drive(60), over);
    expect([codes(r.violations), r.tracker.compensation, new Date(r.tracker.lastWeeklyRest.endedAt).toISOString()])
      .toEqual([[], [], '2026-10-06T12:00:00.000Z']);
  });
});

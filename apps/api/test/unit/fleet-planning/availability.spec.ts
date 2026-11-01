/**
 * Driver availability (stage 1 output): can depart from, driving left,
 * must be home by — read at the moment the driver can depart.
 */
import { driverAvailability } from '../../../src/fleet-planning/rules/availability';
import type { DriverStatusSnapshot } from '../../../src/fleet-planning/rules/driver-state';
import { d, status } from '../../fixtures/driver-status';

const AT = d('2026-10-07T08:00:00Z');
const avail = (over: Partial<DriverStatusSnapshot> = {}, at = AT) => driverAvailability(status(over), at);
const iso = (x: Date) => x.toISOString();
const codes = (list: { code: string }[]) => list.map((m) => m.code);

describe('can depart from', () => {
  it('a rested driver: now', () => {
    expect(iso(avail().canDepartFrom)).toBe('2026-10-07T08:00:00.000Z');
  });

  it('a weekly rest still running: its end', () => {
    expect(iso(avail({ weeklyRestEndedAt: d('2026-10-08T05:00:00Z') }).canDepartFrom)).toBe('2026-10-08T05:00:00.000Z');
  });

  it('unavailable (leave) until Friday: Friday', () => {
    expect(iso(avail({ unavailableUntil: d('2026-10-09T00:00:00Z') }).canDepartFrom)).toBe('2026-10-09T00:00:00.000Z');
  });

  it('on duty with the 9 h used: after an 11 h daily rest', () => {
    const shift = { onDuty: true, dailyRestEndedAt: d('2026-10-06T22:00:00Z'), drivingSinceDailyRestMinutes: 540, drivingSinceBreakMinutes: 0, workSinceBreakMinutes: 0, extendedDrivingDaysUsed: 2 };
    expect(iso(avail(shift).canDepartFrom)).toBe('2026-10-07T19:00:00.000Z');
  });

  it('asked for a later moment: that moment', () => {
    expect(iso(avail({}, d('2026-10-07T12:00:00Z')).canDepartFrom)).toBe('2026-10-07T12:00:00.000Z');
  });
});

describe('driving left', () => {
  it('a fresh day with one 10-hour day left: 9 h, 10 h extended; week and fortnight from the counters', () => {
    expect(avail().drivingLeft).toEqual({ untilBreak: 270, today: 540, todayExtended: 600, week: 3360 - 900, fortnight: 5400 - 900 - 2400, total: 540 });
  });

  it('both 10-hour days used: no extension', () => {
    expect(avail({ extendedDrivingDaysUsed: 2 }).drivingLeft.todayExtended).toBe(540);
  });

  it('the week is the limit: 50 h driven leaves 6 h', () => {
    const left = avail({ drivingThisWeekMinutes: 3000, drivingLastWeekMinutes: 1000 }).drivingLeft;
    expect([left.week, left.total]).toEqual([360, 360]);
  });

  it('the fortnight is the limit: 50 h last week leaves 40 h this week', () => {
    const left = avail({ drivingThisWeekMinutes: 2000, drivingLastWeekMinutes: 3000 }).drivingLeft;
    expect([left.fortnight, left.total]).toEqual([400, 400]);
  });

  it('on duty: the day and the break counters continue', () => {
    const shift = { onDuty: true, dailyRestEndedAt: d('2026-10-07T05:00:00Z'), drivingSinceDailyRestMinutes: 120, drivingSinceBreakMinutes: 100, workSinceBreakMinutes: 150 };
    const left = avail(shift).drivingLeft;
    expect([left.untilBreak, left.today]).toEqual([170, 420]);
  });
});

describe('deadlines', () => {
  it('weekly rest latest start = end of the last one + 6 × 24 h; home = last home rest + 28 days', () => {
    const a = avail();
    expect([iso(a.weeklyRestLatestStart), iso(a.mustBeHomeBy), a.nextWeeklyRestMayBeReduced]).toEqual(['2026-10-11T06:00:00.000Z', '2026-11-02T06:00:00.000Z', true]);
  });

  it('after a reduced weekly rest: the next may not be reduced; compensation listed', () => {
    const a = avail({ weeklyRestType: 'REDUCED', compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z'), recentWeeklyRests: [{ type: 'REDUCED', endedAt: d('2026-10-05T06:00:00Z'), abroad: false }, { type: 'REGULAR', endedAt: d('2026-09-28T06:00:00Z'), abroad: false }] });
    expect([a.nextWeeklyRestMayBeReduced, a.compensationOwed.map((c) => [c.minutes, iso(c.dueBy)])]).toEqual([false, [[1260, '2026-10-26T00:00:00.000Z']]]);
  });

  it('on duty: the latest start of the daily rest (11 h inside 24 h)', () => {
    const shift = { onDuty: true, dailyRestEndedAt: d('2026-10-07T05:00:00Z'), drivingSinceDailyRestMinutes: 120, drivingSinceBreakMinutes: 100, workSinceBreakMinutes: 150 };
    expect(iso(avail(shift).dailyRestLatestStart)).toBe('2026-10-07T18:00:00.000Z');
  });
});

describe('what the status already says', () => {
  it('a status over 56 h: the violation is reported', () => {
    expect(codes(avail({ drivingThisWeekMinutes: 3400, drivingLastWeekMinutes: 0 }).violations)).toEqual(['WEEKLY_DRIVING_EXCEEDED']);
  });

  it('home rest overdue: a warning', () => {
    expect(codes(avail({ lastHomeRestEndedAt: d('2026-09-01T06:00:00Z') }).warnings)).toEqual(['HOME_RETURN_LATE']);
  });

  it('on duty unknown: cannot drive before a regular daily rest (worst case), said so', () => {
    const a = avail({ onDuty: null });
    expect([iso(a.canDepartFrom), a.drivingLeft.today, codes(a.notices)]).toEqual(['2026-10-07T19:00:00.000Z', 540, ['DRIVER_STATE_ASSUMED']]);
  });

  it('unknown rest at home: must be home by asOf, HOME_RETURN_LATE, said so', () => {
    const a = avail({ lastHomeRestEndedAt: null });
    expect([iso(a.mustBeHomeBy), codes(a.warnings), codes(a.notices)]).toEqual(['2026-10-07T08:00:00.000Z', ['HOME_RETURN_LATE'], ['DRIVER_STATE_ASSUMED']]);
  });

  it('unknown type and compensation: the next weekly rest must be regular, 21 h owed', () => {
    const a = avail({ weeklyRestType: null, compensationOwedMinutes: null });
    expect([a.nextWeeklyRestMayBeReduced, a.compensationOwed.map((c) => [c.minutes, iso(c.dueBy)])]).toEqual([false, [[1260, '2026-10-26T00:00:00.000Z']]]);
  });

  it('compensation deadline already passed: the violation is reported', () => {
    expect(codes(avail({ compensationOwedMinutes: 600, compensationDueBy: d('2026-10-06T00:00:00Z') }).violations)).toEqual(['COMPENSATION_OVERDUE']);
  });

  it('unknown counters: said so', () => {
    expect(codes(avail({ reducedDailyRestsUsed: null }).notices)).toEqual(['DRIVER_STATE_ASSUMED']);
  });
});

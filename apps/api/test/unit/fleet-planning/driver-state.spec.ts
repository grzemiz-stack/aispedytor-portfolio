/**
 * Driver status → engine start: origin, aged week counters, worst case for
 * unknown values (DRIVER_STATE_ASSUMED), staleness.
 */
import { DriverStatusError, engineStart } from '../../../src/fleet-planning/rules/driver-state';
import { d, status, t } from '../../fixtures/driver-status';

const NOW = t('2026-10-07T08:00:00Z');
const codes = (s: ReturnType<typeof engineStart>) => s.messages.map((m) => [m.code, m.params?.field ?? m.params?.asOf]);

describe('origin and earliest start', () => {
  it('known values pass through unchanged, no messages', () => {
    const s = engineStart(status(), NOW);
    expect([s.origin, s.earliestStart, s.drivingThisWeek, s.drivingLastWeek, s.extendedDaysUsed, s.reducedDailyRestsUsed, s.shift, s.messages])
      .toEqual([t('2026-10-07T08:00:00Z'), t('2026-10-07T08:00:00Z'), 900, 2400, 1, 1, null, []]);
  });

  it('a weekly rest still running: origin is its end', () => {
    const s = engineStart(status({ weeklyRestEndedAt: d('2026-10-08T05:00:00Z') }), NOW);
    expect(s.origin).toBe(t('2026-10-08T05:00:00Z'));
  });

  it('unavailability moves only the earliest start', () => {
    const s = engineStart(status({ unavailableUntil: d('2026-10-09T00:00:00Z') }), NOW);
    expect([s.origin, s.earliestStart]).toEqual([t('2026-10-07T08:00:00Z'), t('2026-10-09T00:00:00Z')]);
  });

  it('unavailability that already ended does not move it back', () => {
    expect(engineStart(status({ unavailableUntil: d('2026-10-06T00:00:00Z') }), NOW).earliestStart).toBe(t('2026-10-07T08:00:00Z'));
  });
});

describe('week counters are aged to the week of origin', () => {
  it('status from Friday, weekly rest ends next Monday: this week becomes last week, 10-hour days reset', () => {
    const s = engineStart(status({ asOf: d('2026-10-09T18:00:00Z'), weeklyRestEndedAt: d('2026-10-12T06:00:00Z'), drivingThisWeekMinutes: 2700, extendedDrivingDaysUsed: null }), NOW);
    expect([s.drivingThisWeek, s.drivingLastWeek, s.extendedDaysUsed, codes(s)]).toEqual([0, 2700, 0, []]);
  });

  it('both 10-hour days used last week → none used in the new week', () => {
    const s = engineStart(status({ asOf: d('2026-10-09T18:00:00Z'), weeklyRestEndedAt: d('2026-10-12T06:00:00Z'), extendedDrivingDaysUsed: 2 }), NOW);
    expect(s.extendedDaysUsed).toBe(0);
  });

  it('two weeks later: both counters are zero', () => {
    const s = engineStart(status({ asOf: d('2026-09-25T18:00:00Z'), weeklyRestEndedAt: d('2026-10-05T06:00:00Z') }), NOW);
    expect([s.drivingThisWeek, s.drivingLastWeek]).toEqual([0, 0]);
  });
});

describe('unknown values: worst case, said so', () => {
  it('10-hour days unknown in the same week → both used', () => {
    const s = engineStart(status({ extendedDrivingDaysUsed: null }), NOW);
    expect([s.extendedDaysUsed, codes(s)]).toEqual([2, [['DRIVER_STATE_ASSUMED', 'extendedDrivingDaysUsed']]]);
  });

  it('reduced daily rests unknown → all three used', () => {
    const s = engineStart(status({ reducedDailyRestsUsed: null }), NOW);
    expect([s.reducedDailyRestsUsed, codes(s)]).toEqual([3, [['DRIVER_STATE_ASSUMED', 'reducedDailyRestsUsed']]]);
  });

  it('on duty with unknown counters → day, break and work limits used up', () => {
    const s = engineStart(status({ onDuty: true, dailyRestEndedAt: d('2026-10-07T05:00:00Z') }), NOW);
    expect(s.shift).toEqual({ dutyStart: t('2026-10-07T05:00:00Z'), driving: 540, drivingSinceBreak: 270, workSinceBreak: 360 });
    expect(codes(s).map((c) => c[1])).toEqual(['drivingSinceDailyRestMinutes', 'drivingSinceBreakMinutes', 'workSinceBreakMinutes']);
  });

  it('on duty with known counters → taken as they are', () => {
    const s = engineStart(status({ onDuty: true, dailyRestEndedAt: d('2026-10-07T05:00:00Z'), drivingSinceDailyRestMinutes: 120, drivingSinceBreakMinutes: 30, workSinceBreakMinutes: 60 }), NOW);
    expect([s.shift, s.messages]).toEqual([{ dutyStart: t('2026-10-07T05:00:00Z'), driving: 120, drivingSinceBreak: 30, workSinceBreak: 60 }, []]);
  });
});

describe('unknown compensation: the earliest deadline', () => {
  it('a reduced rest ending Tue 13.10 10:00 may have started Sun 11.10 13:01 → due 2.11, not 9.11', () => {
    const s = engineStart(status({ asOf: d('2026-10-13T12:00:00Z'), weeklyRestEndedAt: d('2026-10-13T10:00:00Z'), weeklyRestType: 'REDUCED', compensationOwedMinutes: null, lastHomeRestEndedAt: d('2026-10-05T06:00:00Z') }), t('2026-10-13T12:00:00Z'));
    expect(s.compensation).toEqual([{ minutes: 1260, dueBy: t('2026-11-02T00:00:00Z') }]);
  });

  it('a rest ending Mon 12.10 05:00 started in the week of 5.10 whatever its length → 2.11', () => {
    const s = engineStart(status({ asOf: d('2026-10-12T06:00:00Z'), weeklyRestEndedAt: d('2026-10-12T05:00:00Z'), weeklyRestType: 'REDUCED', compensationOwedMinutes: null }), t('2026-10-12T06:00:00Z'));
    expect(s.compensation.map((c) => new Date(c.dueBy).toISOString())).toEqual(['2026-11-02T00:00:00.000Z']);
  });
});

describe('on duty or not: explicit, unknown = worst case', () => {
  const value = (s: ReturnType<typeof engineStart>, field: string) => s.messages.find((m) => m.params?.field === field)?.params?.value;

  it('onDuty false → resting, no shift, nothing assumed', () => {
    const s = engineStart(status({ onDuty: false }), NOW);
    expect([s.shift, s.messages]).toEqual([null, []]);
  });

  it('onDuty unknown → on duty with the day, the break and work used up, said so', () => {
    const s = engineStart(status({ onDuty: null }), NOW);
    expect(s.shift).toEqual({ dutyStart: t('2026-10-06T19:00:00Z'), driving: 540, drivingSinceBreak: 270, workSinceBreak: 360 });
    expect([codes(s), value(s, 'onDuty')]).toEqual([[['DRIVER_STATE_ASSUMED', 'onDuty']], true]);
  });

  it('onDuty unknown: the duty cannot start before the weekly rest ended', () => {
    const s = engineStart(status({ onDuty: null, weeklyRestEndedAt: d('2026-10-07T02:00:00Z') }), NOW);
    expect(s.shift?.dutyStart).toBe(t('2026-10-07T02:00:00Z'));
  });

  it('onDuty unknown while the weekly rest still runs → resting, nothing assumed', () => {
    const s = engineStart(status({ onDuty: null, weeklyRestEndedAt: d('2026-10-08T05:00:00Z') }), NOW);
    expect([s.shift, s.messages]).toEqual([null, []]);
  });

  it('a provider status that contradicts itself is refused, naming the field', () => {
    const refused = (over: object) => {
      try { engineStart(status(over), NOW); return 'accepted'; } catch (e) { return e instanceof DriverStatusError ? e.field : e; }
    };
    expect([
      refused({ onDuty: false, dailyRestEndedAt: d('2026-10-07T05:00:00Z') }),
      refused({ onDuty: true }),
    ]).toEqual(['onDuty', 'dailyRestEndedAt']);
  });

  it('a provider that gives the daily rest end with onDuty null is taken as on duty (it knows the duty start)', () => {
    const s = engineStart(status({ onDuty: null, dailyRestEndedAt: d('2026-10-07T05:00:00Z'), drivingSinceDailyRestMinutes: 60, drivingSinceBreakMinutes: 60, workSinceBreakMinutes: 60 }), NOW);
    expect([s.shift?.dutyStart, s.messages]).toEqual([t('2026-10-07T05:00:00Z'), []]);
  });

  it('onDuty true → the given counters, as before', () => {
    const s = engineStart(status({ onDuty: true, dailyRestEndedAt: d('2026-10-07T05:00:00Z'), drivingSinceDailyRestMinutes: 120, drivingSinceBreakMinutes: 30, workSinceBreakMinutes: 60 }), NOW);
    expect([s.shift, s.messages]).toEqual([{ dutyStart: t('2026-10-07T05:00:00Z'), driving: 120, drivingSinceBreak: 30, workSinceBreak: 60 }, []]);
  });
});

describe('unknown type, rest at home, compensation (docs/decisions.md §11)', () => {
  const value = (s: ReturnType<typeof engineStart>, field: string) => s.messages.find((m) => m.params?.field === field)?.params?.value;

  it('weekly rest type unknown → REDUCED, said so', () => {
    const s = engineStart(status({ weeklyRestType: null }), NOW);
    expect([s.lastWeeklyRest.type, codes(s), value(s, 'weeklyRestType')]).toEqual(['REDUCED', [['DRIVER_STATE_ASSUMED', 'weeklyRestType']], 'REDUCED']);
  });

  it('last rest at home unknown → due at asOf, said so; the known date gives no such deadline', () => {
    const s = engineStart(status({ lastHomeRestEndedAt: null }), NOW);
    expect([s.lastHomeRestEndedAt, s.homeRestDueBy, codes(s), value(s, 'lastHomeRestEndedAt')])
      .toEqual([null, t('2026-10-07T08:00:00Z'), [['DRIVER_STATE_ASSUMED', 'lastHomeRestEndedAt']], '2026-10-07T08:00:00.000Z']);
    expect([engineStart(status(), NOW).homeRestDueBy, engineStart(status(), NOW).lastHomeRestEndedAt]).toEqual([null, t('2026-10-05T06:00:00Z')]);
  });

  it('compensation unknown, last weekly rest reduced → 21 h by the earliest deadline (a 24 h rest that started the week before)', () => {
    const s = engineStart(status({ weeklyRestType: 'REDUCED', compensationOwedMinutes: null }), NOW);
    expect([s.compensation, codes(s), value(s, 'compensationOwedMinutes')])
      .toEqual([[{ minutes: 1260, dueBy: t('2026-10-26T00:00:00Z') }], [['DRIVER_STATE_ASSUMED', 'compensationOwedMinutes']], 1260]);
  });

  it('compensation unknown, last weekly rest regular and no list → nothing to owe, said so with 0', () => {
    const s = engineStart(status({ compensationOwedMinutes: null }), NOW);
    expect([s.compensation, value(s, 'compensationOwedMinutes')]).toEqual([[], 0]);
  });

  it('compensation unknown with the list: every reduced rest of known date whose deadline has not passed', () => {
    const recentWeeklyRests = [
      { type: 'REDUCED' as const, endedAt: d('2026-10-05T06:00:00Z'), abroad: true },
      { type: 'REGULAR' as const, endedAt: d('2026-09-28T06:00:00Z'), abroad: false },
      { type: 'REDUCED' as const, endedAt: d('2026-09-21T06:00:00Z'), abroad: true },
    ];
    const s = engineStart(status({ weeklyRestType: 'REDUCED', weeklyRestAbroad: true, recentWeeklyRests, compensationOwedMinutes: null }), NOW);
    expect([s.compensation, value(s, 'compensationOwedMinutes')])
      .toEqual([[{ minutes: 1260, dueBy: t('2026-10-26T00:00:00Z') }, { minutes: 1260, dueBy: t('2026-10-12T00:00:00Z') }], 2520]);
  });

  it('compensation unknown: a reduced rest whose deadline has already passed is not assumed missed', () => {
    const recentWeeklyRests = [
      { type: 'REGULAR' as const, endedAt: d('2026-10-05T06:00:00Z'), abroad: false },
      { type: 'REDUCED' as const, endedAt: d('2026-09-14T06:00:00Z'), abroad: true },
    ];
    expect(engineStart(status({ recentWeeklyRests, compensationOwedMinutes: null }), NOW).compensation).toEqual([]);
  });

  it('compensation unknown: the EARLIEST deadline passed but the latest not yet → still owed, by the latest deadline ', () => {
    // A reduced rest ending Tuesday 13.10 06:00 lasted 24–45 h: it started at the earliest on Sunday 11.10
    // (week of 5.10 → due 2.11), at the latest on Monday 12.10 (week of 12.10 → due 9.11). On 3.11 it may still
    // be owed — before: `[]` (the lenient side). A missed deadline is not assumed, but the debt is not forgotten.
    const recentWeeklyRests = [
      { type: 'REGULAR' as const, endedAt: d('2026-11-02T05:00:00Z'), abroad: false },
      { type: 'REDUCED' as const, endedAt: d('2026-10-13T06:00:00Z'), abroad: false },
    ];
    const asOf = d('2026-11-03T10:00:00Z');
    const s = engineStart(status({ asOf, weeklyRestEndedAt: d('2026-11-02T05:00:00Z'), recentWeeklyRests, compensationOwedMinutes: null }), asOf.getTime());
    expect(s.compensation).toEqual([{ minutes: 1260, dueBy: t('2026-11-09T00:00:00Z') }]);
  });

  it('type and compensation both unknown: the assumed reduced rest owes 21 h', () => {
    const s = engineStart(status({ weeklyRestType: null, compensationOwedMinutes: null }), NOW);
    expect([s.compensation.map((c) => c.minutes), codes(s).map((c) => c[1])]).toEqual([[1260], ['weeklyRestType', 'compensationOwedMinutes']]);
  });

  it('compensation known as 0 → nothing owed, nothing assumed', () => {
    const s = engineStart(status({ weeklyRestType: 'REDUCED', compensationOwedMinutes: 0 }), NOW);
    expect([s.compensation, s.messages]).toEqual([[], []]);
  });
});

describe('compensation', () => {
  it('owed with its deadline', () => {
    const s = engineStart(status({ compensationOwedMinutes: 1260, compensationDueBy: d('2026-10-26T00:00:00Z') }), NOW);
    expect(s.compensation).toEqual([{ minutes: 1260, dueBy: t('2026-10-26T00:00:00Z') }]);
  });

  describe('owed without a deadline → the earliest the status allows (art. 8(6): the week the reduced rest STARTED), said so', () => {
    const dueBy = (over: Partial<Parameters<typeof status>[0]>) => {
      const s = engineStart(status({ weeklyRestType: 'REDUCED', ...over }), NOW);
      return [new Date(s.compensation[0].dueBy).toISOString(), codes(s)];
    };
    const ASSUMED = [['DRIVER_STATE_ASSUMED', 'compensationDueBy']];

    it('a 24 h rest ending Monday 06:00 started on Sunday: the week before counts (26.10, not 2.11)', () => {
      expect(dueBy({ compensationOwedMinutes: 1260 })).toEqual(['2026-10-26T00:00:00.000Z', ASSUMED]);
    });

    it('a 35 h rest (10 h owed) ending Monday 06:00 started on Saturday: 26.10', () => {
      expect(dueBy({ compensationOwedMinutes: 600 })).toEqual(['2026-10-26T00:00:00.000Z', ASSUMED]);
    });

    it('the rest\'s length comes from the amount: 35 h ending Tuesday 05:00 started on Sunday → 26.10 (a 24 h guess would give 2.11)', () => {
      expect(dueBy({ weeklyRestEndedAt: d('2026-10-06T05:00:00Z'), compensationOwedMinutes: 600 })).toEqual(['2026-10-26T00:00:00.000Z', ASSUMED]);
    });

    it('a rest that started and ended in the same week: the end of the third week after it', () => {
      expect(dueBy({ weeklyRestEndedAt: d('2026-10-06T20:00:00Z'), compensationOwedMinutes: 1140 })).toEqual(['2026-11-02T00:00:00.000Z', ASSUMED]);
    });

    it('Scenario 0 (SPEC §8): 26 h ending Mon 12.10 05:00 started Sun 11.10 → 2.11', () => {
      expect(dueBy({ weeklyRestEndedAt: d('2026-10-12T05:00:00Z'), compensationOwedMinutes: 1140 })).toEqual(['2026-11-02T00:00:00.000Z', ASSUMED]);
    });

    const refused = (over: Partial<Parameters<typeof status>[0]>) => {
      try {
        engineStart(status({ weeklyRestType: 'REDUCED', ...over }), NOW);
        return 'accepted';
      } catch (e) {
        return e instanceof DriverStatusError ? ['refused', e.field] : e;
      }
    };

    it('exactly 21 h owed is one rest (derived); 21 h + 1 min is two → refused, no deadline made up', () => {
      expect([dueBy({ compensationOwedMinutes: 1260 })[0], refused({ compensationOwedMinutes: 1261 })])
        .toEqual(['2026-10-26T00:00:00.000Z', ['refused', 'compensationDueBy']]);
    });

    it('the last weekly rest regular: the amount is for an earlier rest of unknown date → refused', () => {
      expect(refused({ weeklyRestType: 'REGULAR', compensationOwedMinutes: 600 })).toEqual(['refused', 'compensationDueBy']);
    });

    it('the last weekly rest type unknown (taken as reduced): derived like a reduced one', () => {
      expect(dueBy({ weeklyRestType: null, compensationOwedMinutes: 1260 })[0]).toBe('2026-10-26T00:00:00.000Z');
    });

    it('a given deadline is kept as it is', () => {
      expect(dueBy({ compensationOwedMinutes: 600, compensationDueBy: d('2026-10-30T00:00:00Z') })).toEqual(['2026-10-30T00:00:00.000Z', []]);
    });
  });

  it('nothing owed → empty', () => {
    expect(engineStart(status(), NOW).compensation).toEqual([]);
  });
});

describe('staleness', () => {
  it('exactly 7 days old → not stale', () => {
    expect(codes(engineStart(status(), NOW + 7 * 24 * 3600 * 1000))).toEqual([]);
  });

  it('over 7 days old → DRIVER_STATUS_STALE with asOf', () => {
    expect(codes(engineStart(status(), NOW + 7 * 24 * 3600 * 1000 + 60000))).toEqual([['DRIVER_STATUS_STALE', '2026-10-07T08:00:00.000Z']]);
  });
});

it('recent weekly rests are carried as epoch ms; null stays null', () => {
  const s = engineStart(status({ recentWeeklyRests: [{ type: 'REDUCED', endedAt: d('2026-10-05T06:00:00Z'), abroad: true }] }), NOW);
  expect(s.recentWeeklyRests).toEqual([{ type: 'REDUCED', endedAt: t('2026-10-05T06:00:00Z'), abroad: true }]);
  expect(engineStart(status(), NOW).recentWeeklyRests).toBeNull();
});

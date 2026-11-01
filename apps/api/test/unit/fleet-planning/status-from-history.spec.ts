/**
 * Driver status from an activity history (rules/status-from-history.ts):
 * the synthetic 28 days of fixtures/driver-history.ts give the status the
 * dispatcher would enter by hand for the same week; what a history cannot
 * tell stays unknown; required values it does not give refuse the status.
 */
import type { DriverActivity, DriverActivityHistory } from '../../../src/fleet-planning/activity/driver-activity-provider';
import { driverAvailability } from '../../../src/fleet-planning/rules/availability';
import { DriverStatusError, engineStart } from '../../../src/fleet-planning/rules/driver-state';
import { statusFromHistory } from '../../../src/fleet-planning/rules/status-from-history';
import { FakeDriverActivityProvider } from '../../fakes/fake-driver-activity-provider';
import { d } from '../../fixtures/driver-status';
import { HISTORY_AS_OF, HISTORY_FROM, HistoryBuilder, MANUAL_STATUS_FOR_HISTORY, syntheticHistory } from '../../fixtures/driver-history';

const PL = { establishmentCountry: 'PL' };
const history = (activities: DriverActivity[] = syntheticHistory(), coveredFrom = HISTORY_FROM, coveredTo = HISTORY_AS_OF): DriverActivityHistory => ({
  source: 'test',
  activities: activities.filter((a) => a.end > coveredFrom && a.start < coveredTo)
    .map((a) => ({ ...a, start: new Date(Math.max(a.start.getTime(), coveredFrom.getTime())), end: new Date(Math.min(a.end.getTime(), coveredTo.getTime())) })),
  coveredFrom,
  coveredTo,
});
const refused = (h: DriverActivityHistory, options: Parameters<typeof statusFromHistory>[1] = PL) => {
  try {
    statusFromHistory(h, options);
    return 'accepted';
  } catch (e) {
    return e instanceof DriverStatusError ? ['refused', e.field] : e;
  }
};

describe('28 days of history = the status entered by hand for the same week', () => {
  const fromHistory = statusFromHistory(history(), PL);

  it('every counter the rules need is the same', () => {
    const { lastHomeRestEndedAt: _h, weeklyRestAtHome: _a, ...expected } = MANUAL_STATUS_FOR_HISTORY;
    const { lastHomeRestEndedAt: _h2, weeklyRestAtHome: _a2, ...actual } = fromHistory;
    expect(actual).toEqual(expected);
  });

  it('the rest at home is not in a tachograph: unknown, taken as due now and said so', () => {
    expect([fromHistory.lastHomeRestEndedAt, fromHistory.weeklyRestAtHome]).toEqual([null, false]);
    const s = engineStart(fromHistory, HISTORY_AS_OF.getTime());
    expect(s.messages.map((m) => [m.code, m.params?.field])).toEqual([['DRIVER_STATE_ASSUMED', 'lastHomeRestEndedAt']]);
  });

  it('availability is the same as from the manual status, apart from the return home', () => {
    const pick = (a: ReturnType<typeof driverAvailability>) => [a.canDepartFrom, a.drivingLeft, a.dailyRestLatestStart, a.weeklyRestLatestStart, a.nextWeeklyRestMayBeReduced, a.compensationOwed, a.violations];
    expect(pick(driverAvailability(fromHistory, HISTORY_AS_OF))).toEqual(pick(driverAvailability(MANUAL_STATUS_FOR_HISTORY, HISTORY_AS_OF)));
  });

  it('through the fake provider (an adapter with only activities)', async () => {
    const provider = new FakeDriverActivityProvider({}, { 'driver-1': syntheticHistory() }, { statusFromHistory: { establishmentCountry: 'PL', asOf: HISTORY_AS_OF } });
    expect(await provider.currentStatus('driver-1')).toEqual(fromHistory);
  });
});

describe('compensation', () => {
  it('a reduced rest abroad, then a rest of 45 h + the whole amount: paid', () => {
    expect(statusFromHistory(history(), PL).compensationOwedMinutes).toBe(0);
  });

  it('a rest not long enough for the whole amount: still owed, by its deadline (the week the reduced rest started)', () => {
    // The weekend rest cut by 30 min of work on Sunday 22:00: 54 h 15 min, 9 h 15 min over 45 h — not the whole 19 h.
    const cut = syntheticHistory().map((a) => (a.cardWithdrawn ? { ...a, end: d('2026-10-04T22:00:00Z') } : a));
    const b = new HistoryBuilder('2026-10-04T22:00:00Z');
    b.activities.push({ type: 'WORK', start: d('2026-10-04T22:00:00Z'), end: d('2026-10-04T22:30:00Z'), country: 'PL' });
    b.activities.push({ type: 'REST', start: d('2026-10-04T22:30:00Z'), end: d('2026-10-05T07:45:00Z'), country: 'PL' });
    const activities = [...cut, ...b.activities].sort((x, y) => x.start.getTime() - y.start.getTime());
    const s = statusFromHistory(history(activities), PL);
    expect([s.compensationOwedMinutes, s.compensationDueBy?.toISOString()]).toEqual([1140, '2026-10-19T00:00:00.000Z']);
  });

  it('two reduced rests not compensated: both amounts, by the earlier deadline', () => {
    const b = new HistoryBuilder('2026-09-07T06:00:00Z');
    const week = (mon: number, reducedEnd: string, weekendEnd: string) => {
      for (let i = 0; i < 3; i++) b.day9('PL').restUntil(`2026-09-${String(mon + i + 1).padStart(2, '0')}T06:00:00Z`, 'PL');
      b.day9('DE').restUntil(reducedEnd, 'DE');            // 24 h: 21 h owed
      b.day9('DE').restUntil(weekendEnd, 'PL');            // 52.5 h: too short to pay 21 h en bloc
    };
    b.day9('PL').restUntil('2026-09-08T06:00:00Z', 'PL');
    for (const next of ['09', '10']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
    b.day9('PL').restUntil('2026-09-11T06:00:00Z', 'PL');
    b.day9('PL').restUntil('2026-09-14T06:00:00Z', 'PL');
    week(14, '2026-09-18T15:45:00Z', '2026-09-21T06:00:00Z');
    week(21, '2026-09-25T15:45:00Z', '2026-09-28T06:00:00Z');
    for (const next of ['29', '30']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
    for (const next of ['10-01', '10-02']) b.day9('PL').restUntil(`2026-${next}T06:00:00Z`, 'PL');
    b.day9('PL').restUntil('2026-10-05T06:00:00Z', 'PL');  // 62 h 15 min: 17 h 15 min over 45 h, still not 21 h
    b.day9('PL').restUntil('2026-10-06T06:00:00Z', 'PL');
    const s = statusFromHistory(history(b.activities, d('2026-09-07T00:00:00Z'), d('2026-10-06T06:00:00Z')), PL);
    // Reduced rests started Thu 17.9 (due 12.10) and Thu 24.9 (due 19.10).
    expect([s.compensationOwedMinutes, s.compensationDueBy?.toISOString()]).toEqual([2520, '2026-10-12T00:00:00.000Z']);
  });

  it('compensation attached to a daily rest (art. 8(7) allows any rest of 9 h+) is NOT recognised: still owed — the cautious side', () => {
    const b = new HistoryBuilder('2026-08-31T06:00:00Z');
    const weekPL = (days: string[], weekendEnd: string) => {
      for (const next of days) b.day9('PL').restUntil(next, 'PL');
      b.day9('PL').restUntil(weekendEnd, 'PL');
    };
    weekPL(['2026-09-01T06:00:00Z', '2026-09-02T06:00:00Z', '2026-09-03T06:00:00Z', '2026-09-04T06:00:00Z'], '2026-09-07T06:00:00Z');
    weekPL(['2026-09-08T06:00:00Z', '2026-09-09T06:00:00Z', '2026-09-10T06:00:00Z', '2026-09-11T06:00:00Z'], '2026-09-14T06:00:00Z');
    weekPL(['2026-09-15T06:00:00Z', '2026-09-16T06:00:00Z', '2026-09-17T06:00:00Z', '2026-09-18T06:00:00Z'], '2026-09-21T06:00:00Z');
    for (const next of ['22', '23', '24']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
    b.day9('DE').restUntil('2026-09-25T22:45:00Z', 'DE');   // Thu 15:45 + 31 h: reduced weekly rest, 14 h owed
    b.day9('DE').rest(23 * 60, 'PL');                         // Sat 08:30: 9 h daily rest + the 14 h attached (art. 8(7))
    b.day9('PL').restUntil('2026-09-28T06:00:00Z', 'PL');
    for (const next of ['29', '30']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
    b.day9('PL').restUntil('2026-10-01T06:00:00Z', 'PL');
    b.day9('PL').restUntil('2026-10-01T20:00:00Z', 'PL');
    const s = statusFromHistory(history(b.activities, d('2026-08-31T00:00:00Z'), d('2026-10-01T20:00:00Z')), PL);
    // By the regulation it was taken on Saturday; the history alone cannot tell a 23 h daily rest
    // with compensation from a long daily rest, so it stays owed (due by the week the reduced rest started + 3).
    expect([s.compensationOwedMinutes, s.compensationDueBy?.toISOString(), s.weeklyRestType]).toEqual([840, '2026-10-19T00:00:00.000Z', 'REDUCED']);
  });

  it('less than 28 days of history: a reduced rest before it may still be owed → unknown', () => {
    const s = statusFromHistory(history(syntheticHistory(), d('2026-09-21T00:00:00Z')), PL);
    expect([s.compensationOwedMinutes, s.compensationDueBy]).toEqual([null, null]);
  });
});

describe('places', () => {
  it('a rest with no country is not abroad (the exception for rests abroad is not opened)', () => {
    const noCountry = syntheticHistory().map((a) => ({ ...a, country: null }));
    expect(statusFromHistory(history(noCountry), PL).recentWeeklyRests?.map((r) => r.abroad)).toEqual([false, false, false]);
  });

  it('abroad is counted from the company\'s Member State', () => {
    expect(statusFromHistory(history(), { establishmentCountry: 'DE' }).recentWeeklyRests?.map((r) => r.abroad)).toEqual([true, true, false]);
  });
});

describe('the start of the window: worst case until the first weekly rest', () => {
  it('a history starting inside a weekly rest: its covered part is classified on its own (41 h 45 min, so reduced)', () => {
    const s = statusFromHistory(history(syntheticHistory(), d('2026-09-12T12:00:00Z'), d('2026-09-21T12:00:00Z')), PL);
    expect(s.recentWeeklyRests).toEqual([
      { type: 'REGULAR', endedAt: d('2026-09-21T06:00:00Z'), abroad: false },
      { type: 'REDUCED', endedAt: d('2026-09-14T06:00:00Z'), abroad: false },
    ]);
    // Under 4 weeks of history: what is owed from before it is unknown.
    expect(s.compensationOwedMinutes).toBeNull();
  });

  it('counters before the first weekly rest do not leak: reduced daily rests are counted from it', () => {
    expect(statusFromHistory(history(), PL).reducedDailyRestsUsed).toBe(1);
  });
});

describe('the end of the history', () => {
  it('no activity between the last one and the status moment is rest, as a tachograph counts it', () => {
    const withoutLastRest = syntheticHistory().slice(0, -1);
    expect(statusFromHistory(history(withoutLastRest), PL)).toEqual(statusFromHistory(history(), PL));
  });
});

describe('on duty at the status moment', () => {
  it('Tuesday 12:00, driving since 09:30: the shift counters come from the history', () => {
    const s = statusFromHistory(history(syntheticHistory(), HISTORY_FROM, d('2026-10-06T12:00:00Z')), PL);
    expect([s.dailyRestEndedAt?.toISOString(), s.drivingSinceDailyRestMinutes, s.drivingSinceBreakMinutes, s.workSinceBreakMinutes, s.drivingThisWeekMinutes])
      .toEqual(['2026-10-06T04:15:00.000Z', 420, 150, 150, 1020]);
  });
});

describe('required values the history does not give: refused', () => {
  it('no coverage at all', () => {
    expect(refused({ source: 'test', activities: [], coveredFrom: null, coveredTo: null })).toEqual(['refused', 'weeklyRestEndedAt']);
  });

  it('last week not fully covered → driving last week is not known', () => {
    expect(refused(history(syntheticHistory(), d('2026-09-28T00:01:00Z')))).toEqual(['refused', 'drivingLastWeekMinutes']);
  });

  it('no weekly rest in the history', () => {
    const b = new HistoryBuilder('2026-09-28T06:00:00Z');
    for (let i = 0; i < 9; i++) b.day9('PL').rest(14 * 60 + 15, 'PL');
    expect(refused(history(b.activities, d('2026-09-28T00:00:00Z'), d('2026-10-07T06:00:00Z')))).toEqual(['refused', 'weeklyRestEndedAt']);
  });

  it('a status moment outside the coverage', () => {
    expect(refused(history(), { establishmentCountry: 'PL', asOf: d('2026-10-08T00:00:00Z') })).toEqual(['refused', 'asOf']);
  });
});

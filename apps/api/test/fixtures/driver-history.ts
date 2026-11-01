/**
 * A synthetic 28-day activity history (invented, no real driver), the kind
 * an adapter reads from a driver card file or a tachograph program. Status
 * moment: Wednesday 7 Oct 2026 08:00 UTC; company established in PL.
 *
 *   Thu 10.9, Fri 11.9      9 h days in PL; regular weekly rest at home until Mon 14.9 06:00
 *   Mon 14.9 – Fri 18.9     9 h days in PL; regular weekly rest until Mon 21.9 06:00
 *   Mon 21.9 – Thu 24.9     9 h days in DE; REDUCED weekly rest in DE, 26 h, until Fri 25.9 17:45
 *                           (19 h of compensation owed, due by Mon 19.10)
 *   Fri 25.9 17:45          a 9 h duty back to PL; regular weekly rest (50.5 h) until Mon 28.9 06:00
 *   Mon 28.9 – Fri 2.10     9 h days in PL; 64 h rest with the card withdrawn (45 h + the 19 h
 *                           compensation) until Mon 5.10 07:45
 *   Mon 5.10                a 10-hour day; reduced daily rest (9 h) until Tue 04:15
 *   Tue 6.10                a 9 h day until 14:00; resting at 08:00 on Wednesday
 *
 * A 9 h day: 4.5 h driving, 45 min break, 4.5 h driving. A 10-hour day adds
 * a 45 min break and 1 h of driving.
 */
import type { DriverActivity } from '../../src/fleet-planning/activity/driver-activity-provider';
import type { DriverStatusSnapshot } from '../../src/fleet-planning/rules/driver-state';
import { d } from './driver-status';

const MIN = 60_000;

export class HistoryBuilder {
  readonly activities: DriverActivity[] = [];
  private t: number;

  constructor(startIso: string) {
    this.t = Date.parse(startIso);
  }

  private add(type: DriverActivity['type'], minutes: number, country: string | null, cardWithdrawn?: boolean): this {
    const a: DriverActivity = { type, start: new Date(this.t), end: new Date(this.t + minutes * MIN), country };
    if (cardWithdrawn) a.cardWithdrawn = true;
    this.activities.push(a);
    this.t += minutes * MIN;
    return this;
  }

  drive(minutes: number, country: string | null): this {
    return this.add('DRIVE', minutes, country);
  }

  rest(minutes: number, country: string | null, cardWithdrawn?: boolean): this {
    return this.add('REST', minutes, country, cardWithdrawn);
  }

  restUntil(iso: string, country: string | null, cardWithdrawn?: boolean): this {
    return this.rest((Date.parse(iso) - this.t) / MIN, country, cardWithdrawn);
  }

  /** 4.5 h + 45 min + 4.5 h. */
  day9(country: string): this {
    return this.drive(270, country).rest(45, country).drive(270, country);
  }

  /** A 10-hour day: 4.5 h + 45 min + 4.5 h + 45 min + 1 h. */
  day10(country: string): this {
    return this.day9(country).rest(45, country).drive(60, country);
  }
}

export const HISTORY_AS_OF = d('2026-10-07T08:00:00Z');
export const HISTORY_FROM = d('2026-09-09T08:00:00Z');

export function syntheticHistory(): DriverActivity[] {
  const b = new HistoryBuilder('2026-09-10T06:00:00Z');
  b.day9('PL').restUntil('2026-09-11T06:00:00Z', 'PL');
  b.day9('PL').restUntil('2026-09-14T06:00:00Z', 'PL');
  for (const next of ['15', '16', '17', '18']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
  b.day9('PL').restUntil('2026-09-21T06:00:00Z', 'PL');
  for (const next of ['22', '23', '24']) b.day9('DE').restUntil(`2026-09-${next}T06:00:00Z`, 'DE');
  b.day9('DE').restUntil('2026-09-25T17:45:00Z', 'DE');
  b.day9('DE').restUntil('2026-09-28T06:00:00Z', 'PL');
  for (const next of ['29', '30']) b.day9('PL').restUntil(`2026-09-${next}T06:00:00Z`, 'PL');
  for (const next of ['10-01', '10-02']) b.day9('PL').restUntil(`2026-${next}T06:00:00Z`, 'PL');
  b.day9('PL').restUntil('2026-10-05T07:45:00Z', 'PL', true);
  b.day10('PL').restUntil('2026-10-06T04:15:00Z', 'PL');
  b.day9('PL').restUntil('2026-10-07T08:00:00Z', 'PL');
  return b.activities;
}

/**
 * The same week as the dispatcher would enter it by hand (POST status) —
 * counted from the description above, not by the engine. The rest at home
 * is the one value a tachograph does not record.
 */
export const MANUAL_STATUS_FOR_HISTORY: DriverStatusSnapshot = {
  asOf: HISTORY_AS_OF,
  weeklyRestEndedAt: d('2026-10-05T07:45:00Z'),
  weeklyRestType: 'REGULAR',
  weeklyRestAbroad: false,
  weeklyRestAtHome: true,
  recentWeeklyRests: [
    { type: 'REGULAR', endedAt: d('2026-10-05T07:45:00Z'), abroad: false },
    { type: 'REGULAR', endedAt: d('2026-09-28T06:00:00Z'), abroad: false },
    { type: 'REDUCED', endedAt: d('2026-09-25T17:45:00Z'), abroad: true },
  ],
  drivingThisWeekMinutes: 600 + 540,
  drivingLastWeekMinutes: 5 * 540,
  extendedDrivingDaysUsed: 1,
  reducedDailyRestsUsed: 1,
  compensationOwedMinutes: 0,
  compensationDueBy: null,
  lastHomeRestEndedAt: d('2026-10-05T07:45:00Z'),
  driverChoseToStayAway: false,
  onDuty: false,
  dailyRestEndedAt: null,
  drivingSinceDailyRestMinutes: null,
  drivingSinceBreakMinutes: null,
  workSinceBreakMinutes: null,
  unavailableUntil: null,
};

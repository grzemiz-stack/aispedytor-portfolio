/**
 * Test-only DriverActivityProvider: statuses and activities held in memory.
 * `failing: true` makes every call fail the way a broken provider must
 * (DriverActivityProviderError). With `statusFromHistory`, a driver without
 * a stored status gets one computed from the history — the way an adapter
 * with only activities (a card file, telematics) would do it. Passes the
 * contract.
 */
import {
  DriverActivityProviderError,
  type DriverActivity,
  type DriverActivityHistory,
  type DriverActivityProvider,
} from '../../src/fleet-planning/activity/driver-activity-provider';
import type { DriverStatusSnapshot } from '../../src/fleet-planning/rules/driver-state';
import { statusFromHistory } from '../../src/fleet-planning/rules/status-from-history';

export interface FakeStatusFromHistory {
  establishmentCountry: string;
  /** The status moment; the history is read for the 28 days before it. */
  asOf: Date;
}

export class FakeDriverActivityProvider implements DriverActivityProvider {
  readonly source = 'fake';

  constructor(
    private readonly statuses: Record<string, DriverStatusSnapshot> = {},
    private readonly activities: Record<string, DriverActivity[]> = {},
    private readonly options: { failing?: boolean; coveredFrom?: Date; statusFromHistory?: FakeStatusFromHistory } = {},
  ) {}

  async history(driverId: string, from: Date, to: Date): Promise<DriverActivityHistory> {
    if (this.options.failing) throw new DriverActivityProviderError('unavailable');
    if (!(to > from)) return { source: this.source, activities: [], coveredFrom: null, coveredTo: null };
    const coveredFrom = new Date(Math.max(from.getTime(), (this.options.coveredFrom ?? from).getTime()));
    const activities = (this.activities[driverId] ?? [])
      .filter((a) => a.end > coveredFrom && a.start < to)
      .map((a) => ({ ...a, start: new Date(Math.max(a.start.getTime(), coveredFrom.getTime())), end: new Date(Math.min(a.end.getTime(), to.getTime())) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { source: this.source, activities, coveredFrom, coveredTo: new Date(to) };
  }

  async currentStatus(driverId: string): Promise<DriverStatusSnapshot | null> {
    if (this.options.failing) throw new DriverActivityProviderError('unavailable');
    const s = this.statuses[driverId];
    if (s) return structuredClone(s);
    const fromHistory = this.options.statusFromHistory;
    if (!fromHistory || !this.activities[driverId]) return null;
    const asOf = fromHistory.asOf;
    const h = await this.history(driverId, new Date(asOf.getTime() - 28 * 24 * 3600 * 1000), asOf);
    return statusFromHistory(h, { establishmentCountry: fromHistory.establishmentCountry, asOf });
  }
}

/**
 * Driver activity gateway (SPEC §5).
 *
 * Where the driver's working time comes from: today the dispatcher's manual
 * status (`ManualDriverActivityProvider`, the default); later a tachograph
 * program export or a telematics API — adapters the buyer writes behind this
 * interface. Nothing of a third party is implemented in this codebase.
 *
 * Register an implementation in `fleet-planning.module.ts` — the only place
 * where the provider is chosen. Every implementation must pass the contract
 * tests in `test/contract/driver-activity-provider.contract.ts`.
 */
import type { DriverStatusSnapshot } from '../rules/driver-state';

/** Injection token. */
export const DRIVER_ACTIVITY_PROVIDER = Symbol('DRIVER_ACTIVITY_PROVIDER');

export type DriverActivityType = 'DRIVE' | 'WORK' | 'AVAILABILITY' | 'REST';

/**
 * One period of the driver's activity, as a tachograph records it (driver
 * card file, a tachograph program, telematics). The history is the axis the
 * rules engine replays (`rules/status-from-history.ts`).
 */
export interface DriverActivity {
  type: DriverActivityType;
  /** UTC instants; `end` > `start`. */
  start: Date;
  end: Date;
  /**
   * ISO 3166-1 alpha-2 of the country where it took place (for a rest: where
   * it was taken), e.g. from the places the driver enters at the start and
   * end of a working day, or GNSS. null or omitted = not known.
   */
  country?: string | null;
  /**
   * REST only: the driver card was not in a tachograph. Counted as rest, as
   * the tachograph counts it; kept so the dispatcher can see it.
   */
  cardWithdrawn?: boolean;
}

export interface DriverActivityHistory {
  /** Non-empty name of the source (e.g. "manual", "tachograph-file"). */
  source: string;
  /** Sorted by start, not overlapping, inside the requested period and inside the coverage. */
  activities: DriverActivity[];
  /**
   * The part of the requested period the source has data for. Both null =
   * the source keeps no history (callers must not read "no activity" as rest).
   */
  coveredFrom: Date | null;
  coveredTo: Date | null;
}

/**
 * The only error a provider may throw for its source (besides
 * `DriverStatusError` from `statusFromHistory`, when the history cannot give
 * a required value). `reason` is short and machine-readable (e.g. "timeout",
 * "unauthorized", "bad_response").
 */
export class DriverActivityProviderError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message ?? `Driver activity provider error: ${reason}`);
    this.name = 'DriverActivityProviderError';
  }
}

export interface DriverActivityProvider {
  /** Non-empty name of the source. */
  readonly source: string;
  /** Activities between `from` and `to`; an unknown driver or an empty period gives an empty history. */
  history(driverId: string, from: Date, to: Date): Promise<DriverActivityHistory>;
  /** The driver's current status for the rules engine; null when the source has none (unknown driver, no status yet). */
  currentStatus(driverId: string): Promise<DriverStatusSnapshot | null>;
}

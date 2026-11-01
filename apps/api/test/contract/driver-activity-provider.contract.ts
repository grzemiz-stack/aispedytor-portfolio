/**
 * Contract every DriverActivityProvider implementation must pass.
 *
 * Usage, in a `*.spec.ts` file next to your implementation's tests:
 *
 *   import { runDriverActivityProviderContract } from '../contract/driver-activity-provider.contract';
 *   runDriverActivityProviderContract('MyProvider', {
 *     make: async () => ({ provider: new MyProvider(config), knownDriverId: 'a driver your source knows' }),
 *     failing: () => new MyProvider({ ...config, apiKey: 'invalid' }),
 *   });
 *
 * `make` returns a working provider and the id of a driver it has a status
 * for; `failing` returns one whose calls fail (wrong credentials, host down…),
 * so the error shape is checked too. Run: `npx jest test/contract`.
 */
import {
  DriverActivityProviderError,
  type DriverActivityProvider,
} from '../../src/fleet-planning/activity/driver-activity-provider';
import { engineStart } from '../../src/fleet-planning/rules/driver-state';

const FROM = new Date('2026-09-28T00:00:00Z');
const TO = new Date('2026-10-12T00:00:00Z');
const TYPES = ['DRIVE', 'WORK', 'AVAILABILITY', 'REST'];
const UNKNOWN = 'contract-unknown-driver-0000';

export interface ContractSetup {
  make: () => Promise<{ provider: DriverActivityProvider; knownDriverId: string }>;
  failing?: () => DriverActivityProvider;
}

export function runDriverActivityProviderContract(name: string, setup: ContractSetup): void {
  describe(`DriverActivityProvider contract: ${name}`, () => {
    let provider: DriverActivityProvider;
    let known: string;
    beforeAll(async () => {
      ({ provider, knownDriverId: known } = await setup.make());
    });

    it('has a non-empty source name', () => {
      expect(typeof provider.source === 'string' && provider.source.length > 0).toBe(true);
    });

    it('history: sorted, not overlapping, inside the period and the coverage, known types', async () => {
      const h = await provider.history(known, FROM, TO);
      expect(h.source).toBe(provider.source);
      expect((h.coveredFrom == null) === (h.coveredTo == null)).toBe(true);
      const lo = Math.max(FROM.getTime(), h.coveredFrom?.getTime() ?? FROM.getTime());
      const hi = Math.min(TO.getTime(), h.coveredTo?.getTime() ?? TO.getTime());
      if (h.coveredFrom == null) expect(h.activities).toEqual([]);
      let previousEnd = -Infinity;
      for (const a of h.activities) {
        expect([TYPES.includes(a.type), a.start instanceof Date, a.end instanceof Date]).toEqual([true, true, true]);
        expect(a.end.getTime()).toBeGreaterThan(a.start.getTime());
        expect(a.start.getTime()).toBeGreaterThanOrEqual(Math.max(lo, previousEnd));
        expect(a.end.getTime()).toBeLessThanOrEqual(hi);
        previousEnd = a.end.getTime();
        // The country, when given, is ISO 3166-1 alpha-2; "card withdrawn" only on a rest.
        expect(a.country == null || /^[A-Z]{2}$/.test(a.country)).toBe(true);
        expect(a.cardWithdrawn === undefined || (typeof a.cardWithdrawn === 'boolean' && (a.type === 'REST' || !a.cardWithdrawn))).toBe(true);
      }
    });

    it('history: an unknown driver or an empty period gives an empty history, not an error', async () => {
      expect((await provider.history(UNKNOWN, FROM, TO)).activities).toEqual([]);
      expect((await provider.history(known, TO, FROM)).activities).toEqual([]);
    });

    it('history: does not change the dates it was given', async () => {
      const from = new Date(FROM);
      const to = new Date(TO);
      await provider.history(known, from, to);
      expect([from.getTime(), to.getTime()]).toEqual([FROM.getTime(), TO.getTime()]);
    });

    it('currentStatus: a known driver gives a status the rules engine can start from', async () => {
      const s = await provider.currentStatus(known);
      expect(s).not.toBeNull();
      // Required: driving this week and last week, the end of the last weekly rest.
      for (const m of [s!.drivingThisWeekMinutes, s!.drivingLastWeekMinutes]) expect(Number.isInteger(m) && m >= 0).toBe(true);
      for (const date of [s!.asOf, s!.weeklyRestEndedAt]) expect(Number.isNaN(date.getTime())).toBe(false);
      // May be null (unknown — the engine takes the worst case), never undefined or a made-up value.
      expect([null, 'REGULAR', 'REDUCED']).toContain(s!.weeklyRestType);
      expect(s!.lastHomeRestEndedAt === null || !Number.isNaN(s!.lastHomeRestEndedAt.getTime())).toBe(true);
      const owed = s!.compensationOwedMinutes;
      expect(owed === null || (Number.isInteger(owed) && owed >= 0)).toBe(true);
      if (owed === null) expect(s!.compensationDueBy).toBeNull();
      if (owed !== null && owed > 0) expect(s!.compensationDueBy).not.toBeNull();
      // On duty: true with the end of the daily rest, false without it, or null (unknown — worst case).
      expect([true, false, null]).toContain(s!.onDuty);
      if (s!.onDuty === true) expect(s!.dailyRestEndedAt).not.toBeNull();
      if (s!.onDuty === false) expect(s!.dailyRestEndedAt).toBeNull();
      if (s!.recentWeeklyRests) {
        expect(s!.recentWeeklyRests.length).toBeLessThanOrEqual(3);
        expect([s!.recentWeeklyRests[0].type, s!.recentWeeklyRests[0].endedAt.getTime()]).toEqual([s!.weeklyRestType, s!.weeklyRestEndedAt.getTime()]);
      }
      expect(() => engineStart(s!, s!.asOf.getTime())).not.toThrow();
    });

    it('currentStatus: an unknown driver gives null', async () => {
      expect(await provider.currentStatus(UNKNOWN)).toBeNull();
    });

    if (setup.failing) {
      it('a failing provider throws only DriverActivityProviderError with a reason', async () => {
        const broken = setup.failing!();
        for (const call of [() => broken.history(known, FROM, TO), () => broken.currentStatus(known)]) {
          const error = await call().then(() => null, (e: unknown) => e);
          expect(error).toBeInstanceOf(DriverActivityProviderError);
          expect((error as DriverActivityProviderError).reason.length).toBeGreaterThan(0);
        }
      });
    }
  });
}

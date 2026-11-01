/**
 * Fixed week (561/2006 art. 4(i)) in UTC: Monday 00:00 – Sunday 24:00.
 */
import { endOfWeekAfter, nextWeekStart, weekIndex, weekStart } from '../../../src/fleet-planning/rules/fixed-week';

const t = (iso: string) => new Date(iso).getTime();

describe('fixed week', () => {
  it('starts on Monday 00:00 UTC (2026-10-05 is a Monday)', () => {
    expect(new Date(weekStart(weekIndex(t('2026-10-07T12:00:00Z')))).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('Sunday 23:59:59.999 belongs to the week before Monday 00:00', () => {
    expect(weekIndex(t('2026-10-11T23:59:59.999Z')) + 1).toBe(weekIndex(t('2026-10-12T00:00:00Z')));
  });

  it('is UTC, not local time: Monday 00:30 in Warsaw is still the previous week', () => {
    // 2026-10-12 00:30 CEST = 2026-10-11 22:30 UTC
    expect(weekIndex(t('2026-10-12T00:30:00+02:00'))).toBe(weekIndex(t('2026-10-11T12:00:00Z')));
  });

  it('every week is exactly 7 days, also across the end of summer time (25.10.2026)', () => {
    const w = weekIndex(t('2026-10-21T00:00:00Z'));
    expect(weekStart(w + 1) - weekStart(w)).toBe(7 * 24 * 3600 * 1000);
  });

  it('nextWeekStart and endOfWeekAfter', () => {
    expect(new Date(nextWeekStart(t('2026-10-07T12:00:00Z'))).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    // compensation for a reduction in the week of 5 Oct: before the end of the third following week
    expect(new Date(endOfWeekAfter(t('2026-10-07T12:00:00Z'), 3)).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});

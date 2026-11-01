/**
 * Fixed week of 561/2006 art. 4(i): Monday 00:00 to Sunday 24:00, in UTC
 * (tachograph time; SPEC decision 2). Instants are epoch milliseconds.
 */
export const MINUTE_MS = 60_000;
const WEEK_MS = 7 * 24 * 60 * MINUTE_MS;
/** 1970-01-05 was a Monday. */
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);

/** Number of the fixed week that contains `t` (consecutive integers). */
export const weekIndex = (t: number): number => Math.floor((t - MONDAY_EPOCH) / WEEK_MS);

/** Start (Monday 00:00 UTC) of the fixed week with the given number. */
export const weekStart = (index: number): number => MONDAY_EPOCH + index * WEEK_MS;

/** Start of the next fixed week after the one containing `t`. */
export const nextWeekStart = (t: number): number => weekStart(weekIndex(t) + 1);

/** End (Sunday 24:00 UTC) of the n-th fixed week after the one containing `t`. */
export const endOfWeekAfter = (t: number, n: number): number => weekStart(weekIndex(t) + n + 1);

export const minutesBetween = (from: number, to: number): number => (to - from) / MINUTE_MS;
export const addMinutes = (t: number, minutes: number): number => t + minutes * MINUTE_MS;

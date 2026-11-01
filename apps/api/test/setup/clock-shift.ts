/**
 * The clock shifted by +5 years — the second run of the API tests in the full
 * check (`npm run test:future`).
 *
 * A test that assumes a hardcoded date lies "in the future" (e.g. a loading on
 * 2030-10-10) while the code compares it with the real clock passes today and
 * breaks when the calendar catches up. Here the calendar catches up at once:
 * `new Date()` and `Date.now()` are 5 years ahead (and keep moving —
 * `advanceTimers`). Only `Date` is replaced; timers and `process.nextTick`
 * stay real.
 *
 * A test file that controls the clock itself
 * (`jest.useFakeTimers().setSystemTime(NOW)`) wins: before each test the shift
 * comes back only when the clock is not already fake (e.g. after
 * `useRealTimers()` in `afterEach`). That is how tests that depend on "now"
 * should look — a fake clock or an injected "now".
 */
const SHIFT_MS = Math.round(5 * 365.25 * 86_400_000);
const NOT_DATE = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
  'setTimeout', 'clearTimeout',
] as const;

const isFakeDate = () => (Date as unknown as { isFake?: boolean }).isFake === true;
function shiftClock(): void {
  if (isFakeDate()) return;
  jest.useFakeTimers({ now: Date.now() + SHIFT_MS, advanceTimers: true, doNotFake: [...NOT_DATE] });
}

// At once — file-level code and `beforeAll` see the shifted clock too.
shiftClock();
beforeEach(shiftClock);

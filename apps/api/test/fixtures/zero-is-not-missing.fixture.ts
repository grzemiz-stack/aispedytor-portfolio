/**
 * Fixture for the test of the `zero-is-not-missing` rule. NOT production code.
 * Each case sits on a known line — the test asserts the line numbers.
 * Excluded from `npm run lint` by ignorePatterns; the test lints it explicitly (ignore: false).
 */
export function cases(
  num: number | null,
  text: string | null,
  items: number[],
  str: string,
) {
  // CORRECT — must not be reported
  const a1 = items.length ? items[0] : null;          // 13  .length on an array
  const a2 = items.length > 0 ? items[0] : null;      // 14  explicit comparison
  const a3 = str.length ? str : null;                 // 15  .length on a string
  const a4 = num != null ? num : null;              // 16  explicit check
  const a5 = text || null;                               // 17  text field
  const a6 = num ?? null;                              // 18  correct form

  // WRONG — must be reported
  const b1 = num || null;                              // 21  `|| null` on a number
  const b2 = num ? num : null;                      // 22  truthiness test

  return [a1, a2, a3, a4, a5, a6, b1, b2];
}

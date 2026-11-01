/**
 * Contractor risk ratings in the form (paymentRating 1–5, reliabilityScore 0–100).
 *
 * `!= null`, not truthiness: reliability 0 is the worst rating, not a missing
 * rating — api/src/common/counterparty-risk.ts counts it the same way.
 */
export function ratingToForm(value: number | null | undefined): string {
  return value != null ? String(value) : '';
}

/** Reliability outside 0–100 or a fraction — a sentence for the form; valid or empty → null. */
export function reliabilityError(value: string): string | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? null : 'Rzetelność: liczba całkowita 0–100';
}

/** Empty field → null (clears the rating in the API); otherwise a whole number. */
export function ratingFromForm(value: string): number | null {
  return value.trim() === '' ? null : parseInt(value, 10);
}

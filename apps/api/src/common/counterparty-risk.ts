/**
 * Counterparty risk — one definition for the LTL card and negotiation.
 *
 * Returns the list of criteria that fired; an empty list = no risk signal.
 * Missing data (a `null` rating) is NOT a risk — nothing is guessed.
 * The caller decides which criteria it reacts to (negotiation: only
 * PAYMENT — the "payment risk" argument).
 */

export type CounterpartyRiskCriterion = 'BLACKLIST' | 'PAYMENT' | 'RELIABILITY';

/** paymentRating 1–5: this or lower = payment risk (the rule from negotiation). */
export const PAYMENT_RISK_MAX_RATING = 2;

/** reliabilityScore 0–100: below this = reliability risk. */
export const RELIABILITY_RISK_BELOW = 40;

export interface CounterpartyRiskInput {
  isBlacklisted?: boolean | null;
  paymentRating?: number | null;
  reliabilityScore?: number | null;
}

export function counterpartyRisk(c: CounterpartyRiskInput | null | undefined): CounterpartyRiskCriterion[] {
  if (!c) return [];
  const criteria: CounterpartyRiskCriterion[] = [];
  if (c.isBlacklisted === true) criteria.push('BLACKLIST');
  // `!= null`: a rating of 0 is the worst rating, not a missing one.
  if (c.paymentRating != null && c.paymentRating <= PAYMENT_RISK_MAX_RATING) criteria.push('PAYMENT');
  if (c.reliabilityScore != null && c.reliabilityScore < RELIABILITY_RISK_BELOW) criteria.push('RELIABILITY');
  return criteria;
}

/**
 * The offer statuses that qualify for matching against a demand.
 *
 * One source of truth for both paths:
 *   - manual search     (searchOffers)                — as an `IN (...)` condition in SQL
 *   - auto-notification (checkNewOfferAgainstDemands) — as a guard on a single offer
 * The list's `matchCount` (findAll) uses it as well.
 *
 * Both paths must read this one list: if only the SQL query had it, an offer in
 * status COMPLETED would create a notification but never appear in the search.
 *
 * To widen the range, change this one array.
 */
export const MATCHABLE_OFFER_STATUSES = ['NEW', 'ASSIGNED'] as const;

export type MatchableOfferStatus = (typeof MATCHABLE_OFFER_STATUSES)[number];

/**
 * Whether an offer with the given status qualifies for matching.
 *
 * A missing status means "cannot confirm the offer is active" and disqualifies
 * the offer — the same way PostgreSQL treats `NULL IN ('NEW','ASSIGNED')`.
 */
export function isMatchableOfferStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    (MATCHABLE_OFFER_STATUSES as readonly string[]).includes(status)
  );
}

import type { PlanMessage } from './plan-messages';

/**
 * A dead offer opened directly (the offer page, "Znajdź pojazd"): the API adds
 * MATCH_OFFER_NOT_LIVE { reason } to the `warnings` of every match. The screen
 * shows that sentence once — as a bar above the list — not on every card.
 */
export const NOT_LIVE_CODE = 'MATCH_OFFER_NOT_LIVE';

export function offerNotLiveNotice(matches: { warnings?: PlanMessage[] }[] | null | undefined): PlanMessage | null {
  for (const m of matches ?? []) {
    const w = m.warnings?.find((x) => x.code === NOT_LIVE_CODE);
    if (w) return w;
  }
  return null;
}

/** Notes on a match card — without the code already shown in the bar. */
export function cardWarnings(warnings: PlanMessage[] | null | undefined): PlanMessage[] {
  return (warnings ?? []).filter((w) => w.code !== NOT_LIVE_CODE);
}

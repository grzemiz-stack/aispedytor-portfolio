/**
 * The offer margin on the screens.
 *
 * The API computes the margin on save through offerCost. Without a toll (no
 * planner route toll and no manual toll — also no toll provider) it is only an
 * upper bound — `marginWithoutTolls: true` — and the screen writes "≤ X%". The
 * average (dashboard, analytics) is from full margins; a separate number says
 * how many offers have only an upper bound.
 */
export interface MarginFields {
  profitMarginPercent: number | string | null;
  marginWithoutTolls?: boolean | null;
}

export const isUpperBound = (o: MarginFields) => o.profitMarginPercent != null && o.marginWithoutTolls === true;

/** „71.0%”, „≤ 71.0%” (bez myta), „—” (brak). */
export function marginText(o: MarginFields): string {
  if (o.profitMarginPercent == null) return '—';
  const pct = Number(o.profitMarginPercent).toFixed(1);
  return isUpperBound(o) ? `≤ ${pct}%` : `${pct}%`;
}

/** The tooltip at an upper bound. */
export const UPPER_BOUND_HINT = 'Koszt bez myta — prawdziwa marża może być niższa (policz trasę w planerze albo wpisz myto).';

/** The API order: full (descending), then upper bounds, empty last. */
export function byMarginDesc(a: MarginFields, b: MarginFields): number {
  const rank = (o: MarginFields) => (o.profitMarginPercent == null ? 2 : isUpperBound(o) ? 1 : 0);
  return rank(a) - rank(b) || Number(b.profitMarginPercent ?? 0) - Number(a.profitMarginPercent ?? 0);
}

/** The note under an average: how many offers have only an upper bound (outside the average). */
export function upperBoundNote(count: number | null | undefined): string | null {
  return count && count > 0 ? `bez ${count} ofert z marżą tylko jako górną granicą (bez myta)` : null;
}

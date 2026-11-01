/**
 * The "Planuj trasę" link and how the route planner reads it.
 *
 * The rate always travels TOGETHER with its currency. The planner computes
 * the margin in PLN or EUR (`CalculateRouteDto.currency`); a rate in another
 * currency, or without one, is not filled in — the planner says so instead of
 * computing it as PLN.
 */
export type PlannerCurrency = 'PLN' | 'EUR';

const PLANNER_CURRENCIES: readonly string[] = ['PLN', 'EUR'];

export function routePlannerHref(o: { from: string; to: string; price: number | string | null | undefined; currency?: string | null; offerId?: string }): string {
  const q = new URLSearchParams({ from: o.from, to: o.to });
  if (o.price != null && o.price !== '' && o.currency) {
    q.set('freight', String(o.price));
    q.set('currency', o.currency);
  }
  if (o.offerId) q.set('offerId', o.offerId);
  // URLSearchParams encodes a space as "+"; the planner reads both, but %20 reads well everywhere.
  return `/route-planner?${q.toString().replace(/\+/g, '%20')}`;
}

export function freightFromQuery(params: Pick<URLSearchParams, 'get'>): { freight: string | null; currency: PlannerCurrency; notice: string | null } {
  const freight = params.get('freight');
  const currency = params.get('currency')?.trim().toUpperCase() ?? null;
  if (!freight) return { freight: null, currency: 'PLN', notice: null };
  if (!currency) return { freight: null, currency: 'PLN', notice: 'Link nie podaje waluty stawki — wpisz stawkę ręcznie.' };
  if (!PLANNER_CURRENCIES.includes(currency)) {
    return { freight: null, currency: 'PLN', notice: `Stawka oferty jest w ${currency} — planer liczy w PLN albo EUR. Wpisz stawkę ręcznie.` };
  }
  return { freight, currency: currency as PlannerCurrency, notice: null };
}

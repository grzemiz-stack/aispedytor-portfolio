import { convert } from './fx';
import { msg, type PlanMessage } from './plan-messages';

/**
 * The offer cost — one basis for negotiation (the argument and the
 * simulation) and the route planner (docs/decisions.md §8).
 *
 * Cost = the company `costPerKm` × km + toll. The company rate is WITHOUT
 * tolls, in the company currency (`costCurrency`) — as LTL counts it. Sources,
 * in this order:
 *  1. a planner route (`route`): km from the route, and the route's toll when
 *     it was quoted (`tollEUR`; `null` = no toll quote — no toll provider);
 *  2. no route: the offer km — an estimate, `OFFER_COST_ESTIMATED`;
 *  3. no distance: no cost, `OFFER_COST_NO_DISTANCE`.
 * The toll: the manual one from the offer first, else the route's; without
 * either the cost is without tolls, `OFFER_COST_WITHOUT_TOLLS` (a margin from
 * it is an upper bound). Without the company `costPerKm`: no cost,
 * `OFFER_COST_RATE_MISSING` — no constants (before: fuel 32 l/100 km ×
 * 6.50 PLN and "other" 0.5 PLN/km). Exact amounts in EUR (rates from
 * common/fx); the caller rounds.
 */
export interface OfferCostInput {
  /** A planner route: road km and the toll in EUR (`null` = not quoted) — a saved `route_calculations` row or the variant computed now. */
  route: { distanceKm: number; tollEUR: number | null } | null;
  /** The offer distance (from the offer or estimated) — used only without a route. */
  offerDistanceKm: number | null;
  /** The toll entered by hand on the offer (`tollCostEstimate`), in the offer currency. */
  manualToll: { amount: number; currency: string } | null;
  company: { costPerKm: number | null; costCurrency: string };
}

export type OfferCost =
  | {
      ok: true;
      source: 'route' | 'company_rate';
      distanceKm: number;
      /** The per-km part: rate × km in the company currency. */
      perKm: { rate: number; currency: string; amount: number; amountEUR: number };
      /** The toll in EUR and where from; `null` = no toll in the cost (`withoutTolls`). */
      toll: { amountEUR: number; from: 'route' | 'manual' } | null;
      withoutTolls: boolean;
      totalEUR: number;
      messages: PlanMessage[];
    }
  | { ok: false; messages: PlanMessage[] };

export function offerCost(input: OfferCostInput): OfferCost {
  const route = input.route && input.route.distanceKm > 0 ? input.route : null;
  const distanceKm = route?.distanceKm ?? (input.offerDistanceKm && input.offerDistanceKm > 0 ? input.offerDistanceKm : null);
  if (distanceKm == null) return { ok: false, messages: [msg('OFFER_COST_NO_DISTANCE')] };

  const { costPerKm, costCurrency } = input.company;
  if (costPerKm == null) return { ok: false, messages: [msg('OFFER_COST_RATE_MISSING')] };
  const perKmAmount = costPerKm * distanceKm;
  const perKmEUR = convert(perKmAmount, costCurrency, 'EUR');
  if (!perKmEUR.ok) return { ok: false, messages: perKmEUR.messages };

  let toll: { amountEUR: number; from: 'route' | 'manual' } | null = null;
  if (input.manualToll) {
    const m = convert(input.manualToll.amount, input.manualToll.currency, 'EUR');
    if (!m.ok) return { ok: false, messages: m.messages };
    toll = { amountEUR: m.amount, from: 'manual' };
  } else if (route && route.tollEUR != null) {
    toll = { amountEUR: route.tollEUR, from: 'route' };
  }

  const messages: PlanMessage[] = [];
  if (!route) messages.push(msg('OFFER_COST_ESTIMATED'));
  if (!toll) messages.push(msg('OFFER_COST_WITHOUT_TOLLS'));
  return {
    ok: true,
    source: route ? 'route' : 'company_rate',
    distanceKm,
    perKm: { rate: costPerKm, currency: costCurrency, amount: perKmAmount, amountEUR: perKmEUR.amount },
    toll,
    withoutTolls: !toll,
    totalEUR: perKmEUR.amount + (toll?.amountEUR ?? 0),
    messages,
  };
}

/** The cost in `currency`; a currency without a rate → `null` (not a number from another currency). */
export function costIn(cost: Extract<OfferCost, { ok: true }>, currency: string): number | null {
  const c = convert(cost.totalEUR, 'EUR', currency);
  return c.ok ? c.amount : null;
}

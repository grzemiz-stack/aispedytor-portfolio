/**
 * Value of a part-load offer — the LTL ranking key (docs/decisions.md §3).
 *
 * With the company's cost per km: PROFIT = price − detour km × costPerKm −
 * detour toll, in the company's currency. Without it: REVENUE = price in the
 * company's currency. The exact amount — no truncation or rounding before
 * sorting.
 *
 * Detour toll = detour km × the EUR/km rate of the offer's own route, taken
 * only from a `route_calculations` row computed by the toll provider for the
 * axle class of THIS combination (not a defaulted class). Otherwise the toll
 * is not included (`detourToll: null`) and the code says why:
 *  - no provider registered → TOLL_PROVIDER_NOT_CONFIGURED;
 *  - provider registered, offer route not calculated → DETOUR_TOLL_NOT_INCLUDED
 *    { reason: ROUTE_NOT_CALCULATED };
 *  - axle class of the combination unknown → DETOUR_TOLL_NOT_INCLUDED
 *    { reason: VEHICLE_AXLE_CLASS_UNKNOWN }.
 * The profit then excludes the detour toll; the offer stays in the ranking.
 *
 * Exchange rates only from common/fx.ts.
 */
import { convert } from '../common/fx';
import { msg, dedupeMessages, type PlanMessage } from '../common/plan-messages';
import type { AxleClass } from '../common/axle-class';

export type ValueBasis = 'PROFIT' | 'REVENUE';

export interface RouteCalculationRow {
  distanceKm: number;
  tollTotalEur: number | { toString(): string };
  axleClass: string | null;
  axleClassDefaulted: boolean;
  tollNeedsVerification: boolean;
  calculatedAt: Date;
}


export interface OfferValueInput {
  /** `null` = no price given. Zero is a price. */
  price: number | null;
  priceCurrency: string;
  /** Exact (unrounded) detour km. */
  detourKm: number;
  company: { costPerKm: number | null; costCurrency: string };
  /** Axle class of the combination (`combinationAxleClass`); `null` = cannot be determined. */
  vehicleAxleClass: AxleClass | null;
  routeCalculations: RouteCalculationRow[];
  /** Is a TollProvider registered (src/tolls)? Decides the code when no row matches. */
  tollProviderConfigured: boolean;
}

export interface OfferValue {
  /** Profit or revenue in the company's currency; `null` = cannot be computed (offer goes last). */
  amount: number | null;
  currency: string;
  basis: ValueBasis;
  detourKm: number;
  /** km × costPerKm; `null` without a cost per km. */
  detourCost: number | null;
  /** Detour toll; `null` when not included (the code says why) or without a cost per km. */
  detourToll: number | null;
  /** No price but a known cost: the price below which the extra load loses money. */
  thresholdPrice: number | null;
  codes: PlanMessage[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Detour toll in EUR, or `null` with the reason it is not included.
 * Row: the newest with the matching, non-defaulted class and distance > 0.
 */
function detourTollEur(
  detourKm: number,
  vehicleAxleClass: AxleClass | null,
  rows: RouteCalculationRow[],
  tollProviderConfigured: boolean,
): { eur: number | null; codes: PlanMessage[] } {
  if (detourKm <= 0) return { eur: 0, codes: [] };
  if (vehicleAxleClass === null) {
    return { eur: null, codes: [msg('DETOUR_TOLL_NOT_INCLUDED', { reason: 'VEHICLE_AXLE_CLASS_UNKNOWN' })] };
  }
  const row = rows
    .filter(r => r.axleClass === vehicleAxleClass && !r.axleClassDefaulted && r.distanceKm > 0)
    .sort((a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime())[0];
  if (!row) {
    return {
      eur: null,
      codes: [tollProviderConfigured
        ? msg('DETOUR_TOLL_NOT_INCLUDED', { reason: 'ROUTE_NOT_CALCULATED' })
        : msg('TOLL_PROVIDER_NOT_CONFIGURED')],
    };
  }
  const rateEurPerKm = Number(row.tollTotalEur) / row.distanceKm;
  return {
    eur: detourKm * rateEurPerKm,
    codes: [msg('DETOUR_TOLL_ESTIMATED', { rateEurPerKm: round2(rateEurPerKm), axleClass: vehicleAxleClass })],
  };
}

export function offerValue(input: OfferValueInput): OfferValue {
  const { detourKm, company } = input;
  const currency = company.costCurrency;
  const codes: PlanMessage[] = [];

  // Detour cost — only when the company has set a cost per km.
  let detourCost: number | null = null;
  let detourToll: number | null = null;
  if (company.costPerKm != null) {
    detourCost = detourKm * company.costPerKm;
    const toll = detourTollEur(detourKm, input.vehicleAxleClass, input.routeCalculations, input.tollProviderConfigured);
    codes.push(...toll.codes);
    if (toll.eur !== null) {
      // EUR → company currency: both are in the fx table (COMPANY_CURRENCIES ⊂ fx).
      const tollConv = convert(toll.eur, 'EUR', currency);
      if (tollConv.ok) {
        detourToll = tollConv.amount;
        if (toll.eur > 0) codes.push(...tollConv.messages);
      } else {
        codes.push(...tollConv.messages);
      }
    }
  } else {
    codes.push(msg('DETOUR_COST_UNKNOWN'));
  }
  const basis: ValueBasis = detourCost != null ? 'PROFIT' : 'REVENUE';
  const totalCost = detourCost != null ? detourCost + (detourToll ?? 0) : null;

  // Price in the company's currency.
  let amount: number | null = null;
  let thresholdPrice: number | null = null;
  if (input.price == null) {
    codes.push(msg('OFFER_PRICE_MISSING'));
    if (totalCost != null) {
      thresholdPrice = totalCost;
      codes.push(msg('OFFER_THRESHOLD_PRICE', { amount: round2(totalCost), currency }));
    }
  } else {
    const priceConv = convert(input.price, input.priceCurrency, currency);
    codes.push(...priceConv.messages);
    if (priceConv.ok) {
      amount = totalCost != null ? priceConv.amount - totalCost : priceConv.amount;
      if (basis === 'PROFIT' && amount < 0) {
        codes.push(msg('LOAD_DOES_NOT_COVER_DETOUR', { loss: round2(-amount), currency }));
      }
    }
  }

  return { amount, currency, basis, detourKm, detourCost, detourToll, thresholdPrice, codes: dedupeMessages(codes) };
}

/** Amount for display — 2 decimals; sort by `offerValue().amount`. */
export function roundedValue(v: OfferValue): OfferValue {
  const r = (n: number | null) => (n == null ? null : round2(n));
  return {
    ...v,
    amount: r(v.amount),
    detourKm: Math.round(v.detourKm),
    detourCost: r(v.detourCost),
    detourToll: r(v.detourToll),
    thresholdPrice: r(v.thresholdPrice),
  };
}

/**
 * Ranking order: offers with an amount first — by amount descending, ties →
 * fewer detour km, then id. Then offers without an amount (no price / no
 * rate): by detour km, then id. Deterministic — the creation date plays no part.
 */
export function compareByValue(
  a: { offerId: string; value: OfferValue },
  b: { offerId: string; value: OfferValue },
): number {
  const av = a.value.amount;
  const bv = b.value.amount;
  if (av != null && bv == null) return -1;
  if (av == null && bv != null) return 1;
  if (av != null && bv != null && av !== bv) return bv - av;
  if (a.value.detourKm !== b.value.detourKm) return a.value.detourKm - b.value.detourKm;
  return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
}

import type { PrismaService } from '../prisma/prisma.service';
import { costIn, offerCost, type OfferCost } from '../common/offer-cost';
import type { PlanMessage } from '../common/plan-messages';
import { DECIMAL_10_2_MAX } from '../common/db-limits';
import { TRUSTED_ROUTE } from '../common/route-trust';

/**
 * The cost, profit and margin stored with an offer (docs/decisions.md §3a).
 * One base: `offerCost` — the company cost per km × km + toll, km and toll
 * from a planner route when there is one.
 *
 * - the cost in the offer currency; profit = price − cost; margin = profit /
 *   price (%);
 * - without a toll (no route toll, no manual toll — also no toll provider)
 *   the margin is an upper bound — `marginWithoutTolls: true`; full → `false`;
 *   no margin → `null`;
 * - no price, company rate, distance or exchange rate — nothing (all null),
 *   not a guessed number;
 * - a price of 0: cost and loss known, no margin (division by zero);
 * - a margin outside DECIMAL(5,2) (±999.99 %) — no margin instead of a 500;
 *   a cost or profit outside DECIMAL(10,2) — nothing.
 */
export interface OfferEconomics {
  totalCostEstimate: number | null;
  profitEstimate: number | null;
  profitMarginPercent: number | null;
  marginWithoutTolls: boolean | null;
}

export const NO_ECONOMICS: OfferEconomics = {
  totalCostEstimate: null,
  profitEstimate: null,
  profitMarginPercent: null,
  marginWithoutTolls: null,
};

const MARGIN_COLUMN_MAX = 999.99;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fitsSigned = (n: number) => Number.isFinite(n) && Math.abs(n) <= DECIMAL_10_2_MAX;

export function offerEconomics(price: number | null, currency: string, cost: OfferCost): OfferEconomics {
  if (price == null || !cost.ok) return NO_ECONOMICS;
  const inCurrency = costIn(cost, currency);
  if (inCurrency == null) return NO_ECONOMICS;
  const totalCostEstimate = round2(inCurrency);
  const profitEstimate = round2(price - inCurrency);
  if (!fitsSigned(totalCostEstimate) || !fitsSigned(profitEstimate)) return NO_ECONOMICS;
  const margin = price > 0 ? round2(((price - inCurrency) / price) * 100) : null;
  const marginFits = margin != null && Math.abs(margin) <= MARGIN_COLUMN_MAX;
  return {
    totalCostEstimate,
    profitEstimate,
    profitMarginPercent: marginFits ? margin : null,
    marginWithoutTolls: marginFits ? cost.withoutTolls : null,
  };
}

export type CompanyRate = { costPerKm: number | null; costCurrency: string };

/** The company cost per km — once per save (import: once per batch). */
export async function companyRate(prisma: Pick<PrismaService, 'company'>, companyId: string): Promise<CompanyRate> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { costPerKm: true, costCurrency: true } });
  return { costPerKm: c?.costPerKm != null ? Number(c.costPerKm) : null, costCurrency: c?.costCurrency ?? 'PLN' };
}

/** The offer data the cost is computed from. `id` — when the offer exists (the planner route). */
export interface EconomicsInput {
  id?: string;
  price: number | null;
  currency: string;
  distanceKm: number | null;
  tollCostEstimate: number | null;
}

export async function economicsFor(
  prisma: Pick<PrismaService, 'company' | 'routeCalculation'>,
  companyId: string,
  offer: EconomicsInput,
  rate?: CompanyRate,
): Promise<OfferEconomics> {
  const [company, route] = await Promise.all([
    rate ?? companyRate(prisma, companyId),
    offer.id ? trustedRoute(prisma, offer.id) : Promise.resolve(null),
  ]);
  return economicsWithRate(offer, company, route);
}

/** The offer's latest trusted planner route (TRUSTED_ROUTE) — km and toll for the cost; none — null. */
export async function trustedRoute(
  prisma: Pick<PrismaService, 'routeCalculation'>,
  offerId: string,
): Promise<{ distanceKm: number; tollEUR: number | null } | null> {
  const route = await prisma.routeCalculation.findFirst({ where: { offerId, ...TRUSTED_ROUTE }, orderBy: { calculatedAt: 'desc' } });
  if (!route) return null;
  // A route without a toll quote (null) stays "no toll": the margin is an upper bound.
  return { distanceKm: route.distanceKm, tollEUR: route.tollTotalEur == null ? null : Number(route.tollTotalEur) };
}

/** The offer cost — one place for saving and the preview (offerCost: the manual toll first). */
export function costForOffer(
  offer: EconomicsInput,
  company: CompanyRate,
  route: { distanceKm: number; tollEUR: number | null } | null = null,
): OfferCost {
  return offerCost({
    route,
    offerDistanceKm: offer.distanceKm,
    manualToll: offer.tollCostEstimate != null ? { amount: offer.tollCostEstimate, currency: offer.currency } : null,
    company,
  });
}

/** No queries — for the import (the company rate once, new rows have no route). */
export function economicsWithRate(
  offer: EconomicsInput,
  company: CompanyRate,
  route: { distanceKm: number; tollEUR: number | null } | null = null,
): OfferEconomics {
  return offerEconomics(offer.price, offer.currency, costForOffer(offer, company, route));
}

/**
 * The economics preview (the form) — the same function as saving, plus the
 * cost codes to show: a new offer without a route (`create`), an edited one
 * with its saved route (`update`). Without a manual toll the margin is an
 * upper bound.
 */
export function previewEconomics(
  offer: EconomicsInput,
  company: CompanyRate,
  route: { distanceKm: number; tollEUR: number | null } | null = null,
): OfferEconomics & { messages: PlanMessage[] } {
  const cost = costForOffer(offer, company, route);
  return { ...offerEconomics(offer.price, offer.currency, cost), messages: cost.messages };
}

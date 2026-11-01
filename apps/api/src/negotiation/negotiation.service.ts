import { TRUSTED_ROUTE } from '../common/route-trust';
import { calendarDate, countryTimeZone, daysBetween, pickupDay } from '../common/country-timezone';
import type { Offer } from '@prisma/client';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { TOLL_PROVIDER, type TollProvider } from '../tolls/toll-provider';
import { PrismaService } from '../prisma/prisma.service';
import { counterpartyRisk } from '../common/counterparty-risk';
import { convert } from '../common/fx';
import { REVENUE_STATUSES } from '../common/money';
import { dedupeMessages, msg, type PlanMessage } from '../common/plan-messages';
import { offerCost, type OfferCost } from '../common/offer-cost';

// ─── Constants ──────────────────────────────────────────────────────────────

// The offer cost only through common/offer-cost.ts: the company rate × km + toll.
// Before: fuel 32 l/100 km × 6.50 PLN and "other" 0.5 PLN/km here.

/**
 * Currency conversion for one result, only through common/fx
 * (docs/decisions.md §4). An amount in a currency without a rate is left out
 * and counted (TOTAL_EXCLUDES_UNCONVERTED), never added as if it were already
 * in the target currency.
 */
class Fx {
  readonly messages: PlanMessage[] = [];
  private readonly skipped = new Map<string, number>();

  /** Amount in `to`, or `null` when there is no rate (the amount is left out and counted). */
  to(amount: number, from: string | null | undefined, to: string): number | null {
    const r = convert(amount, from ?? '', to);
    if (!r.ok) {
      const key = (from ?? '').trim().toUpperCase() || '?';
      this.skipped.set(key, (this.skipped.get(key) ?? 0) + 1);
      return null;
    }
    this.messages.push(...r.messages);
    return r.amount;
  }

  /** FX_RATE_STATIC once per currency pair, plus TOTAL_EXCLUDES_UNCONVERTED when something was left out. */
  summary(to: string): PlanMessage[] {
    const out = dedupeMessages(this.messages);
    const count = [...this.skipped.values()].reduce((a, b) => a + b, 0);
    if (count > 0) {
      out.push(msg('TOTAL_EXCLUDES_UNCONVERTED', { count, from: [...this.skipped.keys()].sort().join(', '), to }));
    }
    return out;
  }
}

/** Whether the offer's currency has a rate to PLN (costs are computed in PLN). */
const hasRate = (currency: string) => convert(1, currency, 'PLN').ok;

/** Conversion when the rate is known to exist (checked with `hasRate`); a missing rate here is a programming error. */
function sure(amount: number, from: string, to: string): number {
  const r = convert(amount, from, to);
  if (!r.ok) throw new Error(`common/fx: no rate ${from} → ${to}`);
  return r.amount;
}

/** Estimate without price history: rate per km. EUR and PLN have their own rate; any other currency gets the EUR rate converted through fx. */
const FALLBACK_PER_KM: Readonly<Record<string, number>> = { EUR: 1.15, PLN: 4.95 };


const SIMILAR_ROUTE_RADIUS_KM = 100;
/** Contractor vs market: the smallest samples of offers on similar routes. */
const MIN_CONTRACTOR_SAMPLE = 3;
const MIN_MARKET_SAMPLE = 5;
const MIN_ACCEPTABLE_MARGIN_PCT = 8;

/**
 * Scenario verdict from the margin as % of the price: ≥ 20 excellent, ≥ 12 good,
 * ≥ MIN_ACCEPTABLE_MARGIN_PCT acceptable, ≥ 0 low, below that a loss.
 */
const UNCERTAIN = { verdict: 'uncertain' as const, color: '#9ca3af' };

/** Why there is no cost — a sentence from the common/offer-cost.ts code. */
function costUnknownText(messages: PlanMessage[]): string {
  switch (messages[0]?.code) {
    case 'OFFER_COST_RATE_MISSING':
      return 'Firma nie ma ustawionego kosztu kilometra — administrator ustawia go w ustawieniach firmy.';
    case 'OFFER_COST_NO_DISTANCE':
      return 'Oferta nie ma dystansu ani wspolrzednych — policz trase w planerze.';
    default:
      return 'Waluty myta recznego nie da sie przeliczyc na PLN.';
  }
}

export function marginVerdict(marginPct: number): { verdict: PriceScenario['verdict']; color: string } {
  if (marginPct >= 20) return { verdict: 'excellent', color: '#22c55e' };
  if (marginPct >= 12) return { verdict: 'good', color: '#84cc16' };
  if (marginPct >= MIN_ACCEPTABLE_MARGIN_PCT) return { verdict: 'acceptable', color: '#eab308' };
  if (marginPct >= 0) return { verdict: 'low', color: '#f97316' };
  return { verdict: 'loss', color: '#ef4444' };
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface PriceSuggestion {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  optimalPrice: number;
  avgPricePerKm: number;
  marketTrend: 'rising' | 'falling' | 'stable';
  trendPercentChange: number;
  historicalCount: number;
  percentiles: { p25: number; p50: number; p75: number };
  currency: string;
  /** Rates used to convert the price history (FX_RATE_STATIC); prices without a rate are left out (TOTAL_EXCLUDES_UNCONVERTED). */
  messages: PlanMessage[];
}

export interface ContractorProfile {
  name: string;
  totalOrders: number;
  recentOrders30d: number;
  recentOrders90d: number;
  avgRate: number | null;
  paymentRating: number | null;
  reliabilityScore: number | null;
  avgPaymentDays: number | null;
  isRegular: boolean;
  /** On THIS company's blacklist (the contractor is looked up in the caller's company). */
  isBlacklisted: boolean;
  /**
   * The contractor's average rate per km vs the market's on similar routes
   * (the same countries, distance ±100 km). `null` — too small a sample
   * (NEGOTIATION_SAMPLE_TOO_SMALL in `messages`).
   */
  priceVsMarket: 'above' | 'below' | 'market' | null;
  priceVsMarketPct: number | null;
  /** Rates used (FX_RATE_STATIC); offers without a rate are left out of the averages (TOTAL_EXCLUDES_UNCONVERTED). */
  messages: PlanMessage[];
}

export interface NegotiationArgument {
  icon: string;
  type: 'price' | 'trend' | 'relationship' | 'urgency' | 'cost' | 'special';
  title: string;
  text: string;
  strength: number; // 1-10
}

export interface PriceScenario {
  label: string;
  price: number;
  pricePerKm: number;
  marginPLN: number;
  marginPct: number;
  /**
   * `uncertain` — a cost without tolls (OFFER_COST_WITHOUT_TOLLS): the margin
   * is an upper bound, so "excellent / good / acceptable" would promise what
   * is not known; `low` / `loss` stay, as an upper bound below the threshold decides.
   */
  verdict: 'excellent' | 'good' | 'acceptable' | 'low' | 'loss' | 'uncertain';
  color: string;
}

/**
 * What is missing and what to do about it. The machine-readable `reason` and
 * `actions` let the front end build the message and the link to the planner
 * without parsing text.
 */
export interface NegotiationUnavailable {
  /**
   * `currency_unconvertible` — the offer's currency has no rate in common/fx;
   * `cost_unknown` — there is no offer cost (no distance, no company cost per
   * km) — the code is in `code` (common/offer-cost.ts).
   */
  reason: 'cost_unknown' | 'currency_unconvertible';
  /** Message code (CURRENCY_CONVERSION_UNAVAILABLE, OFFER_COST_NO_DISTANCE, OFFER_COST_RATE_MISSING). */
  code?: PlanMessage;
  message: string;
  actions: Array<{
    code: 'calculate_route' | 'enter_toll_manually' | 'set_cost_per_km';
    label: string;
    offerId: string;
  }>;
}

export interface NegotiationSimulation {
  /**
   * false when the toll is unknown or the offer's currency has no rate.
   * Scenarios are then NOT computed: toll left out of the total cost would
   * inflate the margin in every scenario, so the offer would look better than
   * it is. Better to show nothing and say why than a number that errs in the
   * wrong direction.
   */
  available: boolean;
  scenarios: PriceScenario[];
  /** `null` when `available === false`. */
  breakEvenPrice: number | null;
  sweetSpotRange: { min: number | null; max: number | null };
  /** The cost from common/offer-cost.ts, in PLN; `null` when the simulation is unavailable. */
  estimatedCosts: {
    /** The company rate × km. */
    perKmPLN: number | null;
    /** `null`, not 0 — a cost without tolls (`withoutTolls`) or no cost. */
    tollPLN: number | null;
    totalPLN: number | null;
    /** `route` — km (and toll) from the planner route; `company_rate` — offer km (an estimate). */
    source: 'route' | 'company_rate' | null;
    withoutTolls: boolean;
    messages: PlanMessage[];
  };
  /**
   * true when the cost is without tolls: the cost is a lower bound, so the
   * break-even and the sweet spot are lower bounds too, and margins upper bounds.
   */
  costIsLowerBound: boolean;

  /** Where the toll amount comes from (or that there is none). */
  tollCost: NegotiationTollCost;
  unavailable: NegotiationUnavailable | null;
  /**
   * PLN per 1 unit of the offer's currency (common/fx) — the panel uses it to
   * recompute the margin while the slider moves. `null` when the simulation is
   * unavailable. The front end has no exchange rate of its own.
   */
  rateToPLN: number | null;
}

/**
 * Toll cost shown in negotiation. Negotiation does NOT compute it — it takes a
 * ready amount, in a fixed order of precedence:
 *
 *   `manual`     — the dispatcher's manual entry (Offer.tollCostEstimate), always wins
 *   `calculated` — the latest route planner calculation (route_calculations)
 *   `unknown`    — the route was not calculated; an EXPLICIT state, not a missing block
 */
export interface NegotiationTollCost {
  source: 'manual' | 'calculated' | 'unknown';
  /**
   * Amount used in the calculations, in PLN. `null` for `unknown`, and for
   * `manual` when the offer currency has no rate (no PLN amount exists).
   */
  amountPLN: number | null;
  /** true for `manual` — the dispatcher must know they are looking at their own number. */
  enteredByUser: boolean;
  /** Per-country breakdown — only for `calculated`. */
  breakdown: unknown[] | null;
  /** Countries without a rate, with the reason — only for `calculated`. */
  unresolved: unknown[] | null;
  /** When the route was calculated (ISO) — only for `calculated`. */
  calculatedAt: string | null;
  /** true when any rate used is older than 12 months (route_calculations.tollNeedsVerification). */
  needsVerification: boolean;
  /**
   * Amount from the calculation when a manual entry exists as well. Both
   * numbers are shown — the difference is information for the dispatcher,
   * not an error to hide.
   */
  calculatedAmountPLN: number | null;
  /** `amountPLN - calculatedAmountPLN`, when both exist. */
  differencePLN: number | null;
}

export interface NegotiationAnalysis {
  offer: {
    id: string;
    route: string;
    distanceKm: number | null;
    currentPrice: number | null;
    currency: string;
    pricePerKm: number | null;
    pickupDate: string;
    cargoType: string | null;
    isAdr: boolean;
    weightKg: number | null;
  };
  priceSuggestion: PriceSuggestion;
  contractorProfile: ContractorProfile | null;
  arguments: NegotiationArgument[];
  simulation: NegotiationSimulation;
  marketPosition: 'above' | 'below' | 'market';
  marketPositionPct: number;
  tollCost: NegotiationTollCost;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class NegotiationService {
  constructor(
    private readonly prisma: PrismaService,
    /** Only whether one is registered matters: negotiation reads toll from route_calculations. */
    @Optional() @Inject(TOLL_PROVIDER) private readonly tollProvider: TollProvider | null = null,
  ) {}

  // ── Main analysis ─────────────────────────────────────────────────────────

  async analyzeOffer(
    offerId: string,
    companyId: string,
  ): Promise<NegotiationAnalysis> {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, companyId },
      include: {
        contractor: true,
      },
    });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');

    const distanceKm = offer.distanceKm ?? this.estimateDistance(offer);
    const currentPrice = offer.price != null ? Number(offer.price) : null;

    const tollCost = await this.resolveTollCost(offer);
    const cost = await this.offerCostOf(offer, distanceKm, companyId);

    const [priceSuggestion, contractorProfile] = await Promise.all([
      this.getPriceSuggestion(offer, distanceKm, companyId),
      offer.contractorId
        ? this.getContractorAnalysis(offer.contractorId, companyId, offer, distanceKm)
        : Promise.resolve(null),
    ]);

    // The company country — only for a pickup country outside the zone map (the "Pilny termin" day).
    const companyCountry = countryTimeZone(offer.pickupCountry)
      ? null
      : (await this.prisma.company.findUnique({ where: { id: companyId }, select: { country: true } }))?.country ?? null;

    const args = this.getNegotiationArguments(
      offer,
      distanceKm,
      priceSuggestion,
      contractorProfile,
      tollCost,
      cost,
      companyCountry,
    );

    const simulation = await this.simulateNegotiation(
      offerId,
      currentPrice ?? priceSuggestion.optimalPrice,
      companyId,
    );

    let marketPosition: 'above' | 'below' | 'market' = 'market';
    let marketPositionPct = 0;
    // `!= null`, not a truthiness test: a free offer is 100% below the market,
    // not an offer without a price. `avgPrice > 0` stays — it is the divisor.
    if (currentPrice != null && priceSuggestion.avgPrice > 0) {
      const diff =
        ((currentPrice - priceSuggestion.avgPrice) / priceSuggestion.avgPrice) *
        100;
      marketPositionPct = Math.round(diff * 10) / 10;
      if (diff > 5) marketPosition = 'above';
      else if (diff < -5) marketPosition = 'below';
    }

    return {
      offer: {
        id: offer.id,
        route: `${offer.pickupCity} → ${offer.deliveryCity}`,
        distanceKm,
        currentPrice,
        currency: offer.currency,
        pricePerKm: offer.pricePerKm != null ? Number(offer.pricePerKm) : null,
        pickupDate: offer.pickupDate.toISOString(),
        cargoType: offer.cargoType,
        isAdr: offer.isAdr,
        weightKg: offer.weightKg,
      },
      priceSuggestion,
      contractorProfile,
      arguments: args,
      simulation,
      marketPosition,
      marketPositionPct,
      tollCost,
    };
  }

  // ── Price suggestion ──────────────────────────────────────────────────────

  private async getPriceSuggestion(
    offer: Offer,
    distanceKm: number | null,
    companyId: string,
  ): Promise<PriceSuggestion> {
    const currency = offer.currency;

    // Find similar offers: same direction (pickup country → delivery country), ± radius
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const similarOffers = await this.prisma.offer.findMany({
      where: {
        companyId,
        pickupCountry: offer.pickupCountry,
        deliveryCountry: offer.deliveryCountry,
        price: { not: null },
        createdAt: { gte: ninetyDaysAgo },
        id: { not: offer.id },
      },
      select: {
        price: true,
        currency: true,
        distanceKm: true,
        pricePerKm: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Filter by distance similarity if we have distance data
    const filtered = distanceKm
      ? similarOffers.filter((o) => {
          if (!o.distanceKm) return true;
          return Math.abs(o.distanceKm - distanceKm) <= SIMILAR_ROUTE_RADIUS_KM;
        })
      : similarOffers;

    // History prices in the offer's currency, through common/fx; prices without a rate are left out.
    const fx = new Fx();
    const inCurrency = (o: { price: unknown; currency: string }) => fx.to(Number(o.price), o.currency, currency);
    const converted = filtered.map((o) => ({ o, p: inCurrency(o) }));
    const prices = converted
      .map((x) => x.p)
      .filter((p): p is number => p !== null && p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      // No history — estimate from the distance. EUR and PLN use their own
      // per-km rate; another currency gets 1.15 EUR converted through fx; a
      // currency without a rate → 0 (unknown), with the code.
      const fallback = FALLBACK_PER_KM[currency] !== undefined ? null : convert(FALLBACK_PER_KM.EUR, 'EUR', currency);
      const perKm = FALLBACK_PER_KM[currency] ?? (fallback?.ok ? fallback.amount : 0);
      const estimated = distanceKm ? distanceKm * perKm : 0;
      return {
        minPrice: estimated * 0.85,
        maxPrice: estimated * 1.2,
        avgPrice: estimated,
        medianPrice: estimated,
        optimalPrice: estimated,
        avgPricePerKm: perKm,
        marketTrend: 'stable',
        trendPercentChange: 0,
        historicalCount: 0,
        percentiles: { p25: estimated * 0.9, p50: estimated, p75: estimated * 1.1 },
        currency,
        messages: [...fx.summary(currency), ...(fallback?.messages ?? [])],
      };
    }

    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const medianPrice = this.percentile(prices, 50);
    const p25 = this.percentile(prices, 25);
    const p75 = this.percentile(prices, 75);

    // Calculate avg price per km
    const pricesPerKm = converted
      .filter((x) => x.p !== null && x.o.distanceKm && x.o.distanceKm > 0)
      .map((x) => x.p! / x.o.distanceKm!);
    const avgPricePerKm =
      pricesPerKm.length > 0
        ? pricesPerKm.reduce((a, b) => a + b, 0) / pricesPerKm.length
        : 0;

    // Trend: last 30 days vs 30-90 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const known = converted.filter((x) => x.p !== null);
    const recent = known.filter((x) => x.o.createdAt >= thirtyDaysAgo);
    const older = known.filter(
      (x) => x.o.createdAt < thirtyDaysAgo && x.o.createdAt >= ninetyDaysAgo,
    );

    let marketTrend: 'rising' | 'falling' | 'stable' = 'stable';
    let trendPercentChange = 0;

    if (recent.length >= 3 && older.length >= 3) {
      const recentAvg = recent.reduce((s, x) => s + x.p!, 0) / recent.length;
      const olderAvg = older.reduce((s, x) => s + x.p!, 0) / older.length;

      if (olderAvg > 0) {
        trendPercentChange =
          Math.round(((recentAvg - olderAvg) / olderAvg) * 1000) / 10;
        if (trendPercentChange > 3) marketTrend = 'rising';
        else if (trendPercentChange < -3) marketTrend = 'falling';
      }
    }

    // Optimal price: median with seasonal/trend adjustment
    let optimalPrice = medianPrice;
    if (marketTrend === 'rising') optimalPrice *= 1.03;
    else if (marketTrend === 'falling') optimalPrice *= 0.97;

    return {
      minPrice: Math.round(minPrice),
      maxPrice: Math.round(maxPrice),
      avgPrice: Math.round(avgPrice),
      medianPrice: Math.round(medianPrice),
      optimalPrice: Math.round(optimalPrice),
      avgPricePerKm: Math.round(avgPricePerKm * 100) / 100,
      marketTrend,
      trendPercentChange,
      historicalCount: prices.length,
      percentiles: {
        p25: Math.round(p25),
        p50: Math.round(medianPrice),
        p75: Math.round(p75),
      },
      currency,
      messages: fx.summary(currency),
    };
  }

  // ── Contractor analysis ───────────────────────────────────────────────────

  private async getContractorAnalysis(
    contractorId: string,
    companyId: string,
    offer: { id: string; pickupCountry: string; deliveryCountry: string },
    distanceKm: number | null,
  ): Promise<ContractorProfile> {
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: contractorId, companyId },
    });

    if (!contractor) {
      return {
        name: 'Nieznany',
        totalOrders: 0,
        recentOrders30d: 0,
        recentOrders90d: 0,
        avgRate: null,
        paymentRating: null,
        reliabilityScore: null,
        avgPaymentDays: null,
        isRegular: false,
        isBlacklisted: false,
        priceVsMarket: null,
        priceVsMarketPct: null,
        messages: [],
      };
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const route = { pickupCountry: offer.pickupCountry, deliveryCountry: offer.deliveryCountry };

    const [contractorOffers, recentOffers30, recentOffers90, totalOrders, contractorOnRoute, marketOnRoute] =
      await Promise.all([
        this.prisma.offer.findMany({
          where: { contractorId, companyId, price: { not: null } },
          select: { price: true, currency: true, distanceKm: true },
        }),
        // Orders of the last 30 and 90 days — the same revenue statuses as the total; before,
        // offers in any status → "regular partner (0 orders in total, 7 this month)" (decisions §3b).
        this.prisma.offer.count({
          where: { contractorId, companyId, status: { in: [...REVENUE_STATUSES] }, createdAt: { gte: thirtyDaysAgo } },
        }),
        this.prisma.offer.count({
          where: { contractorId, companyId, status: { in: [...REVENUE_STATUSES] }, createdAt: { gte: ninetyDaysAgo } },
        }),
        // Orders = offers in the revenue statuses, counted on read. Before: a
        // `total_orders` column that nothing wrote.
        this.prisma.offer.count({
          where: { contractorId, companyId, status: { in: [...REVENUE_STATUSES] } },
        }),
        // Similar routes: the same countries; the distance is filtered below.
        this.prisma.offer.findMany({
          where: { contractorId, companyId, ...route, price: { not: null }, distanceKm: { not: null }, id: { not: offer.id } },
          select: { price: true, currency: true, distanceKm: true },
        }),
        this.prisma.offer.findMany({
          where: {
            companyId, ...route, price: { not: null }, distanceKm: { not: null }, id: { not: offer.id },
            createdAt: { gte: ninetyDaysAgo },
            // The market without this contractor's offers; `not` in SQL skips NULL — hence OR.
            OR: [{ contractorId: null }, { contractorId: { not: contractorId } }],
          },
          select: { price: true, currency: true, distanceKm: true },
        }),
      ]);

    // Contractor amounts in PLN through common/fx; amounts without a rate are left out.
    const fx = new Fx();
    const contractorPln = contractorOffers
      .map((o) => ({ o, p: fx.to(Number(o.price), o.currency, 'PLN') }))
      .filter((x): x is { o: typeof x.o; p: number } => x.p !== null);

    // Average rate per km
    const ratesPerKm = contractorPln
      .filter((x) => x.o.distanceKm && x.o.distanceKm > 0)
      .map((x) => x.p / x.o.distanceKm!);

    const avgRate =
      ratesPerKm.length > 0
        ? Math.round((ratesPerKm.reduce((a, b) => a + b, 0) / ratesPerKm.length) * 100) / 100
        : null;

    const isRegular = recentOffers30 >= 5;

    // Contractor vs market: the average rate PLN/km on similar routes (the
    // distance ±SIMILAR_ROUTE_RADIUS_KM from the offer's). The "market" is the
    // company's other offers in the system (mostly imported from exchanges),
    // not outside market data. Before: average AMOUNTS from any routes, no km.
    // Too small a sample — no comparison.
    const similarRates = (rows: { price: unknown; currency: string; distanceKm: number | null }[]) =>
      distanceKm == null
        ? []
        : rows
            .filter((r) => r.distanceKm != null && r.distanceKm > 0 && Math.abs(r.distanceKm - distanceKm) <= SIMILAR_ROUTE_RADIUS_KM)
            .map((r) => ({ p: fx.to(Number(r.price), r.currency, 'PLN'), km: r.distanceKm! }))
            .filter((r): r is { p: number; km: number } => r.p !== null)
            .map((r) => r.p / r.km);
    const cRates = similarRates(contractorOnRoute);
    const mRates = similarRates(marketOnRoute);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    let priceVsMarket: ContractorProfile['priceVsMarket'] = null;
    let priceVsMarketPct: number | null = null;
    const sampleMessages: PlanMessage[] = [];
    if (cRates.length < MIN_CONTRACTOR_SAMPLE || mRates.length < MIN_MARKET_SAMPLE) {
      sampleMessages.push(msg('NEGOTIATION_SAMPLE_TOO_SMALL', {
        contractorOffers: cRates.length, marketOffers: mRates.length,
        minContractorOffers: MIN_CONTRACTOR_SAMPLE, minMarketOffers: MIN_MARKET_SAMPLE,
      }));
    } else {
      const c = avg(cRates);
      const m = avg(mRates);
      priceVsMarketPct = Math.round(((c - m) / m) * 1000) / 10;
      priceVsMarket = priceVsMarketPct > 5 ? 'above' : priceVsMarketPct < -5 ? 'below' : 'market';
    }

    return {
      name: contractor.name,
      totalOrders,
      recentOrders30d: recentOffers30,
      recentOrders90d: recentOffers90,
      avgRate,
      paymentRating: contractor.paymentRating,
      reliabilityScore: contractor.reliabilityScore,
      avgPaymentDays: contractor.avgPaymentDays,
      isRegular,
      isBlacklisted: contractor.isBlacklisted === true,
      priceVsMarket,
      priceVsMarketPct,
      messages: [...fx.summary('PLN'), ...sampleMessages],
    };
  }

  // ── Negotiation arguments ─────────────────────────────────────────────────

  private getNegotiationArguments(
    offer: Offer,
    distanceKm: number | null,
    price: PriceSuggestion,
    contractor: ContractorProfile | null,
    tollCost: NegotiationTollCost,
    cost: OfferCost,
    companyCountry: string | null = null,
  ): NegotiationArgument[] {
    const args: NegotiationArgument[] = [];
    const currentPrice = offer.price ? Number(offer.price) : 0;
    const currency = offer.currency;

    // 1. Price vs market
    if (currentPrice > 0 && price.avgPrice > 0) {
      const diff =
        ((currentPrice - price.avgPrice) / price.avgPrice) * 100;
      if (diff < -5) {
        args.push({
          icon: '💰',
          type: 'price',
          title: 'Cena poniżej rynku',
          text: `Stawka rynkowa na trasie ${offer.pickupCity} → ${offer.deliveryCity} to średnio ${price.avgPrice.toLocaleString('pl-PL')} ${currency}. Obecna oferta (${currentPrice.toLocaleString('pl-PL')} ${currency}) jest ${Math.abs(Math.round(diff))}% poniżej rynku. Proponujemy korektę do poziomu ${price.optimalPrice.toLocaleString('pl-PL')} ${currency}.`,
          strength: Math.min(10, Math.round(Math.abs(diff) / 2)),
        });
      } else if (diff > 10) {
        args.push({
          icon: '💰',
          type: 'price',
          title: 'Cena powyżej rynku',
          text: `Oferta ${currentPrice.toLocaleString('pl-PL')} ${currency} jest ${Math.round(diff)}% powyżej średniej rynkowej (${price.avgPrice.toLocaleString('pl-PL')} ${currency}). Mamy silną pozycję negocjacyjną.`,
          strength: 6,
        });
      }
    }

    // 2. Trend argument
    if (price.marketTrend === 'rising' && price.trendPercentChange > 3) {
      args.push({
        icon: '📈',
        type: 'trend',
        title: 'Trend rosnący',
        text: `Stawki na kierunku ${offer.pickupCountry} → ${offer.deliveryCountry} rosną — w ostatnim miesiącu wzrost o ${price.trendPercentChange}%. Obecny poziom rynkowy uzasadnia wyższą stawkę.`,
        strength: 7,
      });
    } else if (price.marketTrend === 'falling' && price.trendPercentChange < -3) {
      args.push({
        icon: '📉',
        type: 'trend',
        title: 'Trend spadkowy',
        text: `Stawki na tym kierunku spadają (${price.trendPercentChange}% w ostatnim miesiącu). Można negocjować niższą cenę powołując się na aktualną sytuację rynkową.`,
        strength: 7,
      });
    }

    // 3. Relationship argument
    if (contractor) {
      if (contractor.isRegular) {
        args.push({
          icon: '🤝',
          type: 'relationship',
          title: 'Stały partner',
          text: `Jako stały partner (${contractor.totalOrders} zleceń łącznie, ${contractor.recentOrders30d} w ostatnim miesiącu), proponujemy stawkę uwzględniającą wolumen współpracy i gwarancję regularnych zleceń.`,
          strength: 8,
        });
      } else if (contractor.totalOrders === 0) {
        args.push({
          icon: '🆕',
          type: 'relationship',
          title: 'Nowy kontrahent',
          text: `Pierwszy zlecenie z tym kontrahentem — warto zaproponować konkurencyjną stawkę, aby zbudować relację i zapewnić przyszłe zlecenia.`,
          strength: 5,
        });
      }

      // Shared risk definition (common/counterparty-risk.ts); negotiation reacts only to the payment criterion.
      if (counterpartyRisk(contractor).includes('PAYMENT')) {
        args.push({
          icon: '⚠️',
          type: 'cost',
          title: 'Ryzyko płatności',
          text: `Kontrahent ma niski rating płatności (${contractor.paymentRating}/5). Należy uwzględnić ryzyko opóźnionych płatności w kalkulacji — wyższa stawka rekompensuje koszt finansowania.`,
          strength: 8,
        });
      }
    }

    // 4. Urgency argument
    if (offer.pickupDate) {
      // Calendar days in the pickup country's zone, not a difference of hours:
      // 22:30Z on 10.10 is already 11.10 in Warsaw, so loading on 11.10 is "dzisiaj".
      const loading = pickupDay(offer.pickupDate, offer.pickupCountry, companyCountry);
      const daysUntil = daysBetween(calendarDate(new Date(), loading.timeZone), loading.day);
      if (daysUntil <= 2 && daysUntil >= 0) {
        args.push({
          icon: '⏰',
          type: 'urgency',
          title: 'Pilny termin',
          text: `Realizacja w ciągu ${daysUntil === 0 ? 'dzisiaj' : daysUntil === 1 ? 'jutro' : `${daysUntil} dni`} — krótki termin realizacji uzasadnia wyższą stawkę ze względu na ograniczoną dostępność pojazdów.`,
          strength: 9,
        });
      }
    }

    // 5. Cost argument
    //
    // An unknown toll gets its own argument instead of no cost argument at all.
    // Missing toll must NOT look like "no reason to warn about the margin" —
    // that would read as confirmation that the margin is fine.
    const formatPln = (n: number) => Math.round(n).toLocaleString('pl-PL');

    if (!cost.ok) {
      args.push({
        icon: '🗺️',
        type: 'cost',
        title: 'Koszt oferty nieznany',
        text: costUnknownText(cost.messages) + ' Marza nie zostala oszacowana.',
        strength: 6,
      });
    } else {
      // Offer price in PLN through common/fx; without a rate there is no margin argument.
      const currentPricePLN = new Fx().to(currentPrice, currency, 'PLN');
      const costPLN = sure(cost.totalEUR, 'EUR', 'PLN');

      if (currentPrice > 0 && currentPricePLN !== null && currentPricePLN > 0) {
        const margin = ((currentPricePLN - costPLN) / currentPricePLN) * 100;
        // Without tolls the margin is an upper bound — the argument is always
        // there, so that an unknown toll does not look like no reason to warn.
        if (margin < 15 || cost.withoutTolls) {
          const kmPart = sure(cost.perKm.amountEUR, 'EUR', 'PLN');
          const tollPart = cost.toll ? sure(cost.toll.amountEUR, 'EUR', 'PLN') : null;
          const parts =
            `stawka ${cost.perKm.rate.toLocaleString('pl-PL')} ${cost.perKm.currency}/km × ${Math.round(cost.distanceKm)} km = ${formatPln(kmPart)} PLN` +
            (tollPart != null ? `, myto: ${formatPln(tollPart)} PLN` : ', bez myta');
          // Where the amount comes from — the dispatcher must see what they are looking at.
          const sourceNote =
            cost.source === 'route'
              ? ` Km${cost.toll?.from === 'route' ? ' i myto' : ''} z trasy policzonej w planerze${tollCost.calculatedAt ? ` (${tollCost.calculatedAt.slice(0, 10)})` : ''}.`
              : ' Bez trasy z planera — km z oferty (szacunek).';
          const manualNote = cost.toll?.from === 'manual' ? ' Myto pochodzi z Twojej recznej korekty w karcie oferty.' : '';
          const noTollNote = !cost.withoutTolls
            ? ''
            : this.tollProvider === null
              ? ' Myto nie jest liczone (brak dostawcy myta) — marza jest gorna granica; wpisz oplaty drogowe recznie w karcie oferty.'
              : ' Myto nieznane — marza jest gorna granica; policz trase w planerze albo wpisz myto recznie.';

          // A difference between the manual entry and the calculation is information, not an error.
          const differenceNote =
            tollCost.differencePLN != null && tollCost.calculatedAmountPLN != null
              ? ` Planer policzyl ${formatPln(tollCost.calculatedAmountPLN)} PLN — roznica ${formatPln(Math.abs(tollCost.differencePLN))} PLN.`
              : '';

          const staleRatesNote = tollCost.needsVerification
            ? ' Uwaga: uzyte stawki myta sa starsze niz 12 miesiecy.'
            : '';

          args.push({
            icon: '⛽',
            type: 'cost',
            title: margin < 15 ? 'Niska marża' : 'Marża niepewna — bez myta',
            text:
              `Koszt oferty to ${formatPln(costPLN)} PLN (${parts}). ` +
              `Przy ofercie ${currentPrice.toLocaleString('pl-PL')} ${currency} marza wynosi ${cost.withoutTolls ? 'co najwyzej' : 'jedynie'} ${margin.toFixed(1)}%.` +
              sourceNote + manualNote + noTollNote + differenceNote + staleRatesNote,
            strength: 8,
          });
        }
      }
    }

    // 6. ADR / special requirements
    if (offer.isAdr) {
      args.push({
        icon: '☢️',
        type: 'special',
        title: 'Transport ADR',
        text: `Transport wymaga certyfikatu ADR${offer.adrClass ? ` klasy ${offer.adrClass}` : ''} — dodatkowe koszty ubezpieczenia, szkolenia kierowcy i ryzyko uzasadniają premię 15-25% do stawki standardowej.`,
        strength: 9,
      });
    }

    if (offer.isFrigo) {
      args.push({
        icon: '❄️',
        type: 'special',
        title: 'Transport chłodniczy',
        text: `Transport wymaga kontrolowanej temperatury${offer.temperatureMin != null ? ` (${offer.temperatureMin}°C do ${offer.temperatureMax}°C)` : ''} — wyższe koszty paliwa agregatem i ograniczona dostępność sprzętu.`,
        strength: 7,
      });
    }

    // Sort by strength, take top 5. The blacklist — always first, within those
    // 5: the 4 strongest others stay.
    const sorted = args.sort((a, b) => b.strength - a.strength);
    if (contractor?.isBlacklisted) {
      return [{
        icon: '⛔',
        type: 'relationship',
        title: 'Kontrahent na czarnej liście',
        text: 'Kontrahent na czarnej liście firmy — nie przyjmuj bez decyzji kierownika',
        strength: 10,
      }, ...sorted.slice(0, 4)];
    }
    return sorted.slice(0, 5);
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  async simulateNegotiation(
    offerId: string,
    proposedPrice: number,
    companyId: string,
  ): Promise<NegotiationSimulation> {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, companyId },
    });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');

    const distanceKm = offer.distanceKm ?? this.estimateDistance(offer);
    // A price of 0 is the contractor's price. Without `!= null` the scenario
    // labelled "Cena kontrahenta" would show the number the user entered.
    const currentPrice = offer.price != null ? Number(offer.price) : proposedPrice;
    const currency = offer.currency;

    // Toll from the same source as the cost argument — the simulator computes nothing itself.
    const tollCost = await this.resolveTollCost(offer);

    // Offer currency without a rate: costs (in PLN) cannot be compared with the
    // price, so nothing is computed (treating it as PLN would make 1000 GBP = 1000 PLN).
    if (!hasRate(currency)) {
      const code = convert(1, currency, 'PLN').messages[0];
      return {
        available: false,
        scenarios: [],
        breakEvenPrice: null,
        sweetSpotRange: { min: null, max: null },
        estimatedCosts: { perKmPLN: null, tollPLN: null, totalPLN: null, source: null, withoutTolls: false, messages: [] },
        costIsLowerBound: false,
        tollCost,
        rateToPLN: null,
        unavailable: {
          reason: 'currency_unconvertible',
          code,
          message: `Brak kursu dla waluty oferty (${currency}) — scenariusze cenowe nie zostaly wyliczone.`,
          actions: [],
        },
      };
    }

    // The cost only from common/offer-cost.ts. Without a cost there are no
    // scenarios: a number from made-up constants (before: 500 km, fuel, "other")
    // would look like a real one.
    const cost = await this.offerCostOf(offer, distanceKm, companyId);
    if (!cost.ok) {
      const code = cost.messages[0];
      return {
        available: false,
        scenarios: [],
        breakEvenPrice: null,
        sweetSpotRange: { min: null, max: null },
        estimatedCosts: { perKmPLN: null, tollPLN: null, totalPLN: null, source: null, withoutTolls: false, messages: cost.messages },
        costIsLowerBound: false,
        tollCost,
        rateToPLN: null,
        unavailable: {
          reason: 'cost_unknown',
          code,
          message: costUnknownText(cost.messages) + ' Scenariusze cenowe nie zostaly wyliczone.',
          actions: code?.code === 'OFFER_COST_RATE_MISSING'
            ? [{ code: 'set_cost_per_km', label: 'Ustaw koszt kilometra firmy', offerId: offer.id }]
            : [{ code: 'calculate_route', label: 'Policz trase w planerze', offerId: offer.id }],
        },
      };
    }

    const dist = cost.distanceKm;
    const totalCostPLN = sure(cost.totalEUR, 'EUR', 'PLN');
    const perKmPLN = sure(cost.perKm.amountEUR, 'EUR', 'PLN');
    const tollPLN = cost.toll ? sure(cost.toll.amountEUR, 'EUR', 'PLN') : null;

    // Get price suggestion for optimal price
    const priceSuggestion = await this.getPriceSuggestion(
      offer,
      distanceKm,
      companyId,
    );

    // Build scenarios
    const toScenarioPLN = (price: number): number => sure(price, currency, 'PLN');

    const scenarioInputs: { label: string; price: number }[] = [
      { label: 'Cena kontrahenta', price: currentPrice },
      { label: '-5% od oferty', price: currentPrice * 0.95 },
      { label: '-10% od oferty', price: currentPrice * 0.9 },
      {
        label: 'Optymalna rynkowa',
        price: priceSuggestion.optimalPrice,
      },
      {
        label: 'Minimalna akceptowalna',
        price: this.calcMinAcceptable(totalCostPLN, currency),
      },
    ];

    // Also include the proposed price if different
    const proposedExists = scenarioInputs.some(
      (s) => Math.abs(s.price - proposedPrice) < 1,
    );
    if (!proposedExists) {
      scenarioInputs.push({ label: 'Twoja propozycja', price: proposedPrice });
    }

    const scenarios: PriceScenario[] = scenarioInputs.map((s) => {
      const pricePLN = toScenarioPLN(s.price);
      const marginPLN = pricePLN - totalCostPLN;
      const marginPct = pricePLN > 0 ? (marginPLN / pricePLN) * 100 : -100;
      const pricePerKm = dist > 0 ? s.price / dist : 0;

      // A cost without tolls: the margin is an upper bound — a verdict only when
      // that bound already decides (loss, low); otherwise `uncertain`.
      const { verdict, color } = cost.withoutTolls && marginPct >= MIN_ACCEPTABLE_MARGIN_PCT ? UNCERTAIN : marginVerdict(marginPct);

      return {
        label: s.label,
        price: Math.round(s.price),
        pricePerKm: Math.round(pricePerKm * 100) / 100,
        marginPLN: Math.round(marginPLN),
        marginPct: Math.round(marginPct * 10) / 10,
        verdict,
        color,
      };
    });

    // Break even
    const breakEvenPrice = Math.round(sure(totalCostPLN, 'PLN', currency));

    // Sweet spot: 12-20% margin
    const sweetMin = Math.round(sure(totalCostPLN / (1 - 0.12), 'PLN', currency));
    const sweetMax = Math.round(sure(totalCostPLN / (1 - 0.2), 'PLN', currency));

    return {
      available: true,
      tollCost,
      unavailable: null,
      rateToPLN: sure(1, currency, 'PLN'),
      scenarios: scenarios.sort((a, b) => b.price - a.price),
      breakEvenPrice,
      sweetSpotRange: { min: sweetMin, max: sweetMax },
      estimatedCosts: {
        perKmPLN: Math.round(perKmPLN),
        tollPLN: tollPLN != null ? Math.round(tollPLN) : null,
        totalPLN: Math.round(totalCostPLN),
        source: cost.source,
        withoutTolls: cost.withoutTolls,
        messages: cost.messages,
      },
      costIsLowerBound: cost.withoutTolls,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  private estimateDistance(offer: Offer): number | null {
    // `!= null`, not a truthiness test: a coordinate of 0 is a coordinate.
    // Road factor 1.3 (LTL uses 1.25) — to be unified, see docs/known-issues.md.
    if (
      offer.pickupLat != null &&
      offer.pickupLng != null &&
      offer.deliveryLat != null &&
      offer.deliveryLng != null
    ) {
      return Math.round(
        this.haversine(
          offer.pickupLat,
          offer.pickupLng,
          offer.deliveryLat,
          offer.deliveryLng,
        ) * 1.3, // road factor
      );
    }
    return null;
  }

  private haversine(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }


  /**
   * Resolves the toll cost of an offer. Negotiation computes nothing here — it takes ready amounts.
   *
   * The order of precedence is a product decision: the dispatcher's manual
   * entry wins over the calculation, because the dispatcher saw the invoice.
   * When both exist, both are returned with the difference.
   */
  /**
   * The offer cost through common/offer-cost.ts: the latest planner route (km
   * and toll — saved only with a complete toll quote), the manual toll from the
   * offer (first), the company cost per km.
   */
  private async offerCostOf(
    offer: { id: string; tollCostEstimate: unknown; currency?: string | null },
    distanceKm: number | null,
    companyId: string,
  ): Promise<OfferCost> {
    const [route, company] = await Promise.all([
      this.prisma.routeCalculation.findFirst({ where: { offerId: offer.id, ...TRUSTED_ROUTE }, orderBy: { calculatedAt: 'desc' } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { costPerKm: true, costCurrency: true } }),
    ]);
    return offerCost({
      route: route ? { distanceKm: route.distanceKm, tollEUR: Number(route.tollTotalEur) } : null,
      offerDistanceKm: distanceKm,
      manualToll: offer.tollCostEstimate != null ? { amount: Number(offer.tollCostEstimate), currency: offer.currency } : null,
      company: { costPerKm: company?.costPerKm != null ? Number(company.costPerKm) : null, costCurrency: company?.costCurrency ?? 'PLN' },
    });
  }

  private async resolveTollCost(offer: {
    id: string;
    tollCostEstimate: unknown;
    currency?: string | null;
  }): Promise<NegotiationTollCost> {
    const latestCalculation = await this.prisma.routeCalculation.findFirst({
      where: { offerId: offer.id, ...TRUSTED_ROUTE },
      orderBy: { calculatedAt: 'desc' },
    });

    // PLN from the EUR toll through common/fx, so rows saved at different times
    // count at the same rate. The tollTotalPln column is still written but not read.
    const calculatedTollPLN = latestCalculation != null
      ? Math.round(sure(Number(latestCalculation.tollTotalEur), 'EUR', 'PLN') * 100) / 100
      : null;

    // The manual toll is in the OFFER currency — the offer form computes it so
    // (margin = price − fuel − toll) and the offer screen shows it so. To PLN
    // through common/fx; a currency without a rate gives no PLN amount (a number
    // from another currency is never taken as PLN). `!= null`: 0 is a value.
    const manualEntered = offer.tollCostEstimate != null;
    const manualConversion = manualEntered
      ? convert(Number(offer.tollCostEstimate), offer.currency, 'PLN')
      : null;
    const manualTollPLN = manualConversion?.ok ? Math.round(manualConversion.amount * 100) / 100 : null;

    if (manualEntered) {
      return {
        source: 'manual',
        amountPLN: manualTollPLN,
        enteredByUser: true,
        breakdown: null,
        unresolved: null,
        calculatedAt: null,
        needsVerification: latestCalculation?.tollNeedsVerification ?? false,
        calculatedAmountPLN: calculatedTollPLN,
        differencePLN: manualTollPLN != null && calculatedTollPLN != null
          ? Math.round((manualTollPLN - calculatedTollPLN) * 100) / 100
          : null,
      };
    }

    if (latestCalculation != null) {
      return {
        source: 'calculated',
        amountPLN: calculatedTollPLN,
        enteredByUser: false,
        breakdown: latestCalculation.tollBreakdown as unknown[],
        unresolved: latestCalculation.tollUnresolved as unknown[],
        calculatedAt: latestCalculation.calculatedAt.toISOString(),
        needsVerification: latestCalculation.tollNeedsVerification,
        calculatedAmountPLN: null,
        differencePLN: null,
      };
    }

    return {
      source: 'unknown',
      amountPLN: null,
      enteredByUser: false,
      breakdown: null,
      unresolved: null,
      calculatedAt: null,
      needsVerification: false,
      calculatedAmountPLN: null,
      differencePLN: null,
    };
  }




  private calcMinAcceptable(totalCostPLN: number, currency: string): number {
    const minPricePLN = totalCostPLN / (1 - MIN_ACCEPTABLE_MARGIN_PCT / 100);
    return Math.round(sure(minPricePLN, 'PLN', currency));
  }
}

import { economicsFor } from '../offers/offer-economics';
import { BadGatewayException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PlannedRoute, type RouteSection } from './route-types';
import { OsrmAdapterService } from './osrm-adapter.service';
import {
  TRUCK_RESTRICTIONS,
  CountryRestrictions,
  EuroClass,
} from './truck-restrictions.data';
import {
  TOLL_PROVIDER,
  TollProviderError,
  type EmissionClass,
  type TollProvider,
  type TollQuote,
  type TollRequest,
} from '../tolls/toll-provider';
import { CalculateRouteDto } from './dto/calculate-route.dto';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { convert } from '../common/fx';
import { dedupeMessages, msg, type PlanMessage } from '../common/plan-messages';
import { offerCost, costIn, type OfferCost } from '../common/offer-cost';
import { plannerAxleClass, type PlannerAxleClass } from '../common/axle-class';

// ─── Constants ───────────────────────────────────────────────────────────────

// Route cost: the company cost per km × km + toll — common/offer-cost.ts. Before:
// fuel from constants 32 l/100 km × 6.50 PLN (or from the fuel fields of the
// request — removed).

/** Emission classes from the DTO (Euro3..Euro6) as sent to the toll provider. */
const EURO_CLASS_TO_EMISSION: Record<EuroClass, EmissionClass> = {
  Euro3: 'EURO_III',
  Euro4: 'EURO_IV',
  Euro5: 'EURO_V',
  Euro6: 'EURO_VI',
};

/**
 * Exchange rates come only from common/fx (docs/decisions.md §4); the planner
 * has no rate table of its own.
 */
const round4 = (n: number) => Math.round(n * 10000) / 10000;


/** EUR ↔ PLN: both currencies are in the fx table — a missing rate is a programming error, not a data gap. */
function eurPln(amount: number, from: 'EUR' | 'PLN', to: 'EUR' | 'PLN') {
  const r = convert(amount, from, to);
  if (!r.ok) throw new Error(`common/fx: no rate ${from} → ${to}`);
  return r;
}

// ─── Result interfaces ──────────────────────────────────────────────────────

/** One country charged by the toll provider, converted to EUR. */
export interface TollBreakdownItem {
  country: string;
  countryCode: string;
  system: string;
  /** km driven in that country (from the route), for display. */
  distanceKm: number;
  /** Amount as returned by the provider. */
  amount: number;
  currency: string;
  /** `amount` in EUR through common/fx. */
  costEUR: number;
}

/** A charged country whose amount could not be converted (currency without a rate). */
export interface TollUnresolvedItem {
  countryCode: string;
  distanceKm: number;
  reason: 'currency_rate_missing';
}

/**
 * Toll of one route. Without a toll provider: `source` and totals are `null`,
 * `complete` is false and `messages` carry TOLL_PROVIDER_NOT_CONFIGURED.
 */
export interface TollCostResult {
  /** Provider name from the quote; `null` when no provider is configured. */
  source: string | null;
  /** true only when a provider returned a quote and every amount was converted. */
  complete: boolean;
  totalEUR: number | null;
  totalPLN: number | null;
  breakdown: TollBreakdownItem[];
  unresolved: TollUnresolvedItem[];
  /** TOLL_PROVIDER_NOT_CONFIGURED, FX_RATE_STATIC, CURRENCY_CONVERSION_UNAVAILABLE. */
  messages: PlanMessage[];
}

export interface MarginResult {
  freightRate: number;
  currency: string;
  /** Route cost in the freight currency; `null` — a currency without a rate (code in `messages`). */
  totalCostInCurrency: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  pricePerKm: number;
  /** false when the cost behind the margin is incomplete (toll not included). */
  complete: boolean;
  /** FX_RATE_STATIC when the cost was converted; CURRENCY_CONVERSION_UNAVAILABLE without a rate. */
  messages: PlanMessage[];
}

export interface RouteAlternative {
  index: number;
  label: string;
  distanceKm: number;
  durationMin: number;
  durationFormatted: string;
  polyline: string;
  sections: RouteSection[];
  costs: {
    tolls: TollCostResult;
    /** The company cost per km × route km (without tolls); `null` — the company has no cost per km. */
    perKm: { rate: number; currency: string; amount: number; amountPLN: number; amountEUR: number } | null;
    /** The per-km part + toll; `null` without a company cost per km (OFFER_COST_RATE_MISSING in `messages`). */
    totalCostPLN: number | null;
    totalCostEUR: number | null;
    costPerKmPLN: number | null;
    costPerKmEUR: number | null;
    /** PLN per 1 EUR — from common/fx, 4 decimal places. */
    eurPlnRate: number;
    /** false when the total does not include toll (no provider, or an amount without a rate). */
    complete: boolean;
    /** Codes from toll and cost: FX_RATE_STATIC, TOLL_PROVIDER_NOT_CONFIGURED, CURRENCY_CONVERSION_UNAVAILABLE, OFFER_COST_*. */
    messages: PlanMessage[];
  };
  margin?: MarginResult;
  countryCodes: string[];
  /** A hub estimate (ROUTE_ESTIMATED) — for viewing, not saved with an offer. */
  estimated: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RoutePlannerService {
  constructor(
    /** Route geometry, distance and km per country — from OSRM. */
    private readonly routeCalculator: OsrmAdapterService,
    private readonly cache: MemoryCacheService,
    private readonly prisma: PrismaService,
    /** Toll amounts — from the registered provider (src/tolls), `null` when none. */
    @Optional() @Inject(TOLL_PROVIDER) private readonly tollProvider: TollProvider | null = null,
  ) {}

  async calculateRoute(dto: CalculateRouteDto, companyId?: string) {
    const euroClass: EuroClass = dto.vehicle.euroClass || 'Euro6';
    // Without an axle count the planner assumes a 5+ combination — and records
    // that the class was assumed, not chosen (common/axle-class.ts).
    const axles = plannerAxleClass(dto.vehicle.axleCount);
    const company = await this.companyCost(companyId);
    // For an offer the planner takes its manual toll first — as the saved margin
    // and negotiation do (offerCost).
    const manualToll = dto.offerId && companyId ? await this.offerManualToll(dto.offerId, companyId) : null;
    const currency = dto.currency || 'PLN';
    const maxAlternatives = dto.maxAlternatives || 3;

    const providerRoutes = await this.routeCalculator.calculateRoute({
      origin: dto.origin,
      destination: dto.destination,
      waypoints: dto.waypoints,
      vehicle: { ...dto.vehicle, euroClass },
      alternatives: maxAlternatives,
    });
    // Neither a route nor an estimate — no guessed distance.
    if (providerRoutes.length === 0) {
      const m = msg('ROUTE_UNAVAILABLE');
      throw new ServiceUnavailableException({ statusCode: 503, ...m, message: m.code });
    }

    // Toll per route from the provider. A provider error ends the request
    // (502 TOLL_PROVIDER_UNAVAILABLE) — nothing is computed or saved without it.
    const grossWeightTonnes = dto.vehicle.grossWeight != null ? dto.vehicle.grossWeight / 1000 : null;
    const alternatives: RouteAlternative[] = [];
    for (const [i, route] of providerRoutes.entries()) {
      const quote = await this.quoteToll({
        route: {
          points: [dto.origin, ...(dto.waypoints ?? []), dto.destination].map(p => ({ lat: p.lat, lng: p.lng })),
          polyline: route.polyline,
          distanceKm: Math.round(route.distance / 1000),
          countries: route.countries.map(c => ({ countryCode: c.countryCode, distanceKm: c.distanceKm })),
        },
        vehicle: {
          axleClass: axles.axleClass,
          emissionClass: EURO_CLASS_TO_EMISSION[euroClass],
          grossWeightTonnes,
        },
      });
      alternatives.push(this.buildRouteAlternative(
        route, i, this.tollCostsFromQuote(quote, route), company, currency, dto.freightRate, manualToll,
      ));
    }

    // The cheapest first; without a company cost per km there is no cost — then the shortest.
    const costKnown = alternatives.every((a) => a.costs.totalCostEUR != null);
    alternatives.sort((a, b) => (costKnown ? a.costs.totalCostEUR! - b.costs.totalCostEUR! : a.distanceKm - b.distanceKm));

    // Assign labels based on characteristics
    this.assignLabels(alternatives, costKnown);

    // Re-index after sort
    alternatives.forEach((alt, i) => { alt.index = i; });

    // Collect all country restrictions across all routes
    const allCountryCodes = new Set<string>();
    for (const alt of alternatives) {
      for (const code of alt.countryCodes) allCountryCodes.add(code);
    }
    const countryRestrictions: CountryRestrictions[] = [];
    for (const code of allCountryCodes) {
      const r = TRUCK_RESTRICTIONS[code];
      if (r) countryRestrictions.push(r);
    }

    // Build recommendation
    const cheapest = alternatives[0];
    const recommendation = this.buildRecommendation(alternatives, currency);

    // Save the result with the offer — only when we know WHICH offer it is for,
    // and only with a complete toll from the provider: a route_calculations row is
    // the toll LTL and negotiation read, so without toll there is nothing to save.
    // An estimated (hub) route and 0 km never reach the offer's cost.
    if (dto.offerId && companyId && cheapest && !cheapest.estimated && cheapest.distanceKm > 0 && cheapest.costs.tolls.source && cheapest.costs.tolls.complete) {
      await this.saveResultWithOffer(dto.offerId, companyId, cheapest, axles);
    }

    return {
      routes: alternatives.map(({ countryCodes, ...rest }) => rest),
      recommendation,
      countryRestrictions,
    };
  }

  /**
   * Saves the calculated route with the offer.
   *
   * The recommended alternative is saved (the cheapest after sorting). The
   * amount does NOT go to `offers.toll_cost_estimate` — that field is the
   * dispatcher's manual correction and takes precedence; the calculation is
   * stored next to it, not instead of it.
   *
   * An offer outside the caller's company ends in NotFound — silently not saving
   * would mislead, because the caller asked for a save and would get a result without one.
   */
  private async saveResultWithOffer(
    offerId: string,
    companyId: string,
    trip: RouteAlternative,
    axles: PlannerAxleClass,
  ): Promise<void> {
    const ownedOffer = await this.prisma.offer.findFirst({
      where: { id: offerId, companyId },
      select: { id: true, price: true, currency: true, distanceKm: true, tollCostEstimate: true },
    });
    if (!ownedOffer) throw new NotFoundException('Oferta nie znaleziona');

    const tolls = trip.costs.tolls;
    await this.prisma.routeCalculation.create({
      data: {
        offerId,
        companyId,
        distanceKm: trip.distanceKm,
        tollTotalEur: tolls.totalEUR!,
        tollTotalPln: tolls.totalPLN!,
        tollBreakdown: tolls.breakdown as unknown as object[],
        tollUnresolved: tolls.unresolved as unknown as object[],
        tollNeedsVerification: false,
        tollSource: tolls.source!,
        routeLabel: trip.label,
        // Which combination the toll was computed for — without it the row cannot be
        // used for the detour toll of a specific vehicle (docs/decisions.md §7).
        axleClass: axles.axleClass,
        axleClassDefaulted: axles.defaulted,
      },
    });
    // The route gives km and toll — the offer's cost, profit and margin again.
    const economics = await economicsFor(this.prisma, companyId, {
      id: offerId,
      price: ownedOffer.price == null ? null : Number(ownedOffer.price),
      currency: ownedOffer.currency,
      distanceKm: ownedOffer.distanceKm,
      tollCostEstimate: ownedOffer.tollCostEstimate == null ? null : Number(ownedOffer.tollCostEstimate),
    });
    await this.prisma.offer.update({ where: { id: offerId, companyId }, data: economics });
    this.cache.deleteByPrefix(`offers:${companyId}`);
  }

  /**
   * The manual toll of the company's offer (in the offer currency) or `null`. An offer outside the
   * company — `null` (saving answers 404 anyway). The currency straight from the offer: the column is
   * NOT NULL (default EUR) and every write path stores a non-empty one.
   */
  private async offerManualToll(offerId: string, companyId: string): Promise<{ amount: number; currency: string } | null> {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, companyId }, select: { tollCostEstimate: true, currency: true } });
    return offer?.tollCostEstimate != null ? { amount: Number(offer.tollCostEstimate), currency: offer.currency } : null;
  }

  /** The company cost per km (from the token); without a company — no cost (OFFER_COST_RATE_MISSING). */
  private async companyCost(companyId?: string): Promise<{ costPerKm: number | null; costCurrency: string }> {
    if (!companyId) return { costPerKm: null, costCurrency: 'PLN' };
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { costPerKm: true, costCurrency: true } });
    return { costPerKm: c?.costPerKm != null ? Number(c.costPerKm) : null, costCurrency: c?.costCurrency ?? 'PLN' };
  }

  // ─── Build single route alternative ────────────────────────────────────────

  private buildRouteAlternative(
    route: PlannedRoute,
    index: number,
    tollCosts: TollCostResult,
    company: { costPerKm: number | null; costCurrency: string },
    currency: string,
    freightRate?: number,
    manualToll: { amount: number; currency: string } | null = null,
  ): RouteAlternative {
    const distanceKm = Math.round(route.distance / 1000);

    // Without a toll quote the cost is without tolls — and says so (`complete: false`,
    // OFFER_COST_WITHOUT_TOLLS).
    const cost = offerCost({ route: { distanceKm, tollEUR: tollCosts.totalEUR }, offerDistanceKm: null, manualToll, company });
    const totalCostPLN = cost.ok ? this.round(costIn(cost, 'PLN')!) : null;
    const totalCostEUR = cost.ok ? this.round(cost.totalEUR) : null;

    const countryCodes = new Set<string>(route.countries.map(c => c.countryCode.toUpperCase()));

    const alt: RouteAlternative = {
      index,
      label: '', // assigned later
      distanceKm,
      durationMin: Math.round(route.duration / 60),
      durationFormatted: this.formatDuration(route.duration),
      polyline: route.polyline,
      sections: route.sections,
      costs: {
        tolls: tollCosts,
        perKm: cost.ok
          ? { rate: cost.perKm.rate, currency: cost.perKm.currency, amount: this.round(cost.perKm.amount), amountPLN: this.round(eurPln(cost.perKm.amountEUR, 'EUR', 'PLN').amount), amountEUR: this.round(cost.perKm.amountEUR) }
          : null,
        totalCostPLN,
        totalCostEUR,
        costPerKmPLN: totalCostPLN != null && distanceKm > 0 ? this.round(totalCostPLN / distanceKm) : null,
        costPerKmEUR: totalCostEUR != null && distanceKm > 0 ? this.round(totalCostEUR / distanceKm) : null,
        eurPlnRate: round4(eurPln(1, 'EUR', 'PLN').amount),
        complete: tollCosts.complete,
        messages: dedupeMessages([...(route.estimated ? [msg('ROUTE_ESTIMATED')] : []), ...tollCosts.messages, ...cost.messages]),
      },
      countryCodes: [...countryCodes],
      estimated: route.estimated === true,
    };

    if (freightRate != null && freightRate > 0) {
      alt.margin = this.calculateMargin(freightRate, currency, cost, distanceKm, tollCosts.complete);
    }

    return alt;
  }

  // ─── Label assignment ──────────────────────────────────────────────────────

  private assignLabels(alternatives: RouteAlternative[], costKnown = true): void {
    if (alternatives.length === 0) return;

    // Sorted by cost — the first is the cheapest. Without a cost there is no "cheapest".
    if (!costKnown) {
      this.assignLabelsWithoutCost(alternatives);
      return;
    }
    const cheapestIdx = 0;
    const shortestIdx = this.findMinIndex(alternatives, (a) => a.distanceKm);
    const fastestIdx = this.findMinIndex(alternatives, (a) => a.durationMin);

    const assigned = new Set<number>();

    // Primary labels
    alternatives[cheapestIdx].label = 'Najtańsza';
    assigned.add(cheapestIdx);

    if (!assigned.has(fastestIdx)) {
      alternatives[fastestIdx].label = 'Najszybsza';
      assigned.add(fastestIdx);
    }

    if (!assigned.has(shortestIdx)) {
      alternatives[shortestIdx].label = 'Najkrótsza';
      assigned.add(shortestIdx);
    }

    // If a route has multiple distinctions, combine
    if (cheapestIdx === fastestIdx && cheapestIdx === shortestIdx) {
      alternatives[cheapestIdx].label = 'Najtańsza / Najszybsza / Najkrótsza';
    } else if (cheapestIdx === fastestIdx) {
      alternatives[cheapestIdx].label = 'Najtańsza / Najszybsza';
    } else if (cheapestIdx === shortestIdx) {
      alternatives[cheapestIdx].label = 'Najtańsza / Najkrótsza';
    } else if (fastestIdx === shortestIdx && !assigned.has(fastestIdx)) {
      // Already assigned above, but combine
      alternatives[fastestIdx].label = 'Najszybsza / Najkrótsza';
    }

    // Remaining routes get numbered labels
    for (let i = 0; i < alternatives.length; i++) {
      if (!alternatives[i].label) {
        alternatives[i].label = `Trasa alternatywna ${i + 1}`;
      }
    }
  }

  /** Without a company cost per km: only "fastest" and "shortest" (the list is sorted by km). */
  private assignLabelsWithoutCost(alternatives: RouteAlternative[]): void {
    const fastestIdx = this.findMinIndex(alternatives, (a) => a.durationMin);
    alternatives[0].label = fastestIdx === 0 ? 'Najkrótsza / Najszybsza' : 'Najkrótsza';
    if (fastestIdx !== 0) alternatives[fastestIdx].label = 'Najszybsza';
    for (let i = 0; i < alternatives.length; i++) {
      if (!alternatives[i].label) alternatives[i].label = `Trasa alternatywna ${i + 1}`;
    }
  }

  private findMinIndex<T>(arr: T[], fn: (item: T) => number): number {
    let minIdx = 0;
    let minVal = fn(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      const val = fn(arr[i]);
      if (val < minVal) {
        minVal = val;
        minIdx = i;
      }
    }
    return minIdx;
  }

  // ─── Recommendation ───────────────────────────────────────────────────────

  private buildRecommendation(
    alternatives: RouteAlternative[],
    currency: string,
  ): { recommendedIndex: number; reason: string } {
    if (alternatives.length === 0) {
      return { recommendedIndex: 0, reason: 'Brak dostępnych tras.' };
    }

    const best = alternatives[0]; // sorted by cost (without a cost — by km)
    const costKey = currency === 'EUR' ? 'totalCostEUR' : 'totalCostPLN';
    const costUnit = currency === 'EUR' ? 'EUR' : 'PLN';
    const bestCost = best.costs[costKey];

    let reason = bestCost != null
      ? `Rekomendowana trasa: ${best.distanceKm} km, ${best.durationFormatted}, koszt ${bestCost} ${costUnit}`
      : `Rekomendowana trasa: ${best.distanceKm} km, ${best.durationFormatted} — koszt nieznany: firma nie ma kosztu kilometra (ustawienia firmy)`;

    if (best.margin && best.margin.marginPercent !== null) {
      reason += `, marża ${best.margin.marginPercent}% (${best.margin.marginValue} ${best.margin.currency})`;
    }

    if (alternatives.length > 1) {
      const second = alternatives[1];
      const secondCost = second.costs[costKey];
      const saving = bestCost != null && secondCost != null ? this.round(secondCost - bestCost) : 0;
      if (saving > 0) {
        reason += `. Oszczędność vs. następna trasa: ${saving} ${costUnit}.`;
      }
    }

    // Add toll countries info
    const tollCountries = best.costs.tolls.breakdown
      .map((b) => `${b.country} (${b.costEUR} EUR)`)
      .join(', ');
    if (tollCountries) {
      reason += ` Myto: ${tollCountries}.`;
    }
    if (!best.costs.complete) {
      reason += ' Koszt bez myta — myto nie zostało policzone.';
    }

    return { recommendedIndex: 0, reason };
  }

  // ─── Toll ───────────────────────────────────────────────────────────────────

  /** Quote from the provider; `null` without one. Any provider failure → 502. */
  private async quoteToll(request: TollRequest): Promise<TollQuote | null> {
    if (!this.tollProvider) return null;
    try {
      return await this.tollProvider.quote(request);
    } catch (e) {
      const reason = e instanceof TollProviderError ? e.reason : 'unexpected_error';
      const m = msg('TOLL_PROVIDER_UNAVAILABLE', { reason });
      throw new BadGatewayException({ statusCode: 502, ...m, message: m.code });
    }
  }

  /** Provider quote → amounts in EUR/PLN through common/fx; no quote → missing, with the code. */
  tollCostsFromQuote(quote: TollQuote | null, route: PlannedRoute): TollCostResult {
    if (!quote) {
      return {
        source: null, complete: false, totalEUR: null, totalPLN: null,
        breakdown: [], unresolved: [], messages: [msg('TOLL_PROVIDER_NOT_CONFIGURED')],
      };
    }
    const km = new Map(route.countries.map(c => [c.countryCode.toUpperCase(), c.distanceKm]));
    const breakdown: TollBreakdownItem[] = [];
    const unresolved: TollUnresolvedItem[] = [];
    const messages: PlanMessage[] = [];
    for (const item of quote.items) {
      const code = item.countryCode.toUpperCase();
      const fx = convert(item.amount, item.currency, 'EUR');
      messages.push(...fx.messages);
      if (!fx.ok) {
        unresolved.push({ countryCode: code, distanceKm: km.get(code) ?? 0, reason: 'currency_rate_missing' });
        continue;
      }
      breakdown.push({
        country: TRUCK_RESTRICTIONS[code]?.country ?? code,
        countryCode: code,
        system: item.system ?? '',
        distanceKm: km.get(code) ?? 0,
        amount: item.amount,
        currency: item.currency,
        costEUR: this.round(fx.amount),
      });
    }
    const totalEUR = this.round(breakdown.reduce((sum, b) => sum + b.costEUR, 0));
    const toPln = eurPln(totalEUR, 'EUR', 'PLN');
    if (totalEUR !== 0) messages.push(...toPln.messages);
    return {
      source: quote.source,
      complete: unresolved.length === 0,
      totalEUR,
      totalPLN: this.round(toPln.amount),
      breakdown,
      unresolved,
      messages: dedupeMessages(messages),
    };
  }

  // ─── Margin calculation ────────────────────────────────────────────────────

  private calculateMargin(
    freightRate: number,
    currency: string,
    cost: OfferCost,
    distanceKm: number,
    complete = true,
  ): MarginResult {
    const pricePerKm = distanceKm > 0
      ? this.round(freightRate / distanceKm)
      : 0;

    // The cost in the freight currency through common/fx. Without a cost (no
    // company cost per km) or without a rate there is no margin — a code, not a zero.
    if (!cost.ok) {
      return { freightRate, currency, totalCostInCurrency: null, marginValue: null, marginPercent: null, pricePerKm, complete, messages: cost.messages };
    }
    const fx = convert(cost.totalEUR, 'EUR', currency);
    if (!fx.ok) {
      return { freightRate, currency, totalCostInCurrency: null, marginValue: null, marginPercent: null, pricePerKm, complete, messages: fx.messages };
    }
    const totalCost = fx.amount;

    const marginValue = this.round(freightRate - totalCost);
    const marginPercent = freightRate > 0
      ? this.round((marginValue / freightRate) * 100)
      : 0;

    return {
      freightRate,
      currency,
      totalCostInCurrency: this.round(totalCost),
      marginValue,
      marginPercent,
      pricePerKm,
      complete,
      messages: fx.messages,
    };
  }

  // ─── Country restrictions ──────────────────────────────────────────────────

  getCountryRestrictions(countryCode: string): CountryRestrictions {
    const code = countryCode.toUpperCase();
    const cacheKey = `restrictions:${code}`;
    const cached = this.cache.get<CountryRestrictions>(cacheKey);
    if (cached) return cached;

    const restrictions = TRUCK_RESTRICTIONS[code];
    if (!restrictions) {
      throw new NotFoundException(
        `No restrictions data for country code: ${code}`,
      );
    }
    this.cache.set(cacheKey, restrictions, 3600);
    return restrictions;
  }

  getAllCountryRestrictions(): CountryRestrictions[] {
    const cacheKey = 'restrictions:all';
    const cached = this.cache.get<CountryRestrictions[]>(cacheKey);
    if (cached) return cached;

    const result = Object.values(TRUCK_RESTRICTIONS);
    this.cache.set(cacheKey, result, 3600);
    return result;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${m}min`;
  }
}

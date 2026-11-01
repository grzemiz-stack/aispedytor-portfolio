import type { Offer } from '@prisma/client';
/**
 * Offer score 1–10 — a HEURISTIC: no AI model, no LLM call (docs/decisions.md §9).
 *
 * Score: a base from the offer's margin thresholds (calcScore), adjusted by its
 * price per km against the average of the same company's other offers on the
 * same country pair. The name `ai-evaluation` is historical (the API paths
 * stay); the only module that calls an LLM is email-agent (README, "How it
 * decides").
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { MoneyInCompanyCurrency } from '../common/money';
import type { PlanMessage } from '../common/plan-messages';

/** `uncertain` — a margin without a toll (an upper bound) ≥ 10 %: the real one may be lower. */
type MarginRating = 'excellent' | 'good' | 'fair' | 'poor' | 'uncertain';
type PricePerKmRating = 'above' | 'at' | 'below' | 'unknown';

export interface EvaluationResult {
  offerId: string;
  /** Deprecated: countries only ("PL→DE"). The planner link — from the fields below. */
  route: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  /** The offer price in its currency; no price — null. */
  price: number | null;
  currency: string;
  score: number;           // 1–10
  priceVsMarket: number | null;     // % vs the average of the company's own offers on this country pair (positive = above)
  marginRating: MarginRating;
  pricePerKmRating: PricePerKmRating;
  routePopularity: number;          // number of the company's other offers on this country pair
  recommendation: string;           // Polish text summary
  calculatedAt: string;
  /** Exchange rates used (FX_RATE_STATIC) and history rates left out for lack of a rate (TOTAL_EXCLUDES_UNCONVERTED). */
  messages: PlanMessage[];
}

@Injectable()
export class AiEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskQueue: TaskQueueService,
  ) {}

  async evaluateOffer(offerId: string, companyId: string): Promise<EvaluationResult> {
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, companyId },
    });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');

    return this.computeEvaluation(offer, companyId);
  }

  async batchEvaluate(companyId: string): Promise<EvaluationResult[]> {
    const newOffers = await this.prisma.offer.findMany({
      where: { companyId, status: 'NEW' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    // Enqueue evaluations with concurrency control (max 3 parallel)
    const promises = newOffers.map((offer) =>
      this.taskQueue.enqueue(() => this.computeEvaluation(offer, companyId)),
    );
    const results = await Promise.all(promises);

    return results.sort((a, b) => b.score - a.score);
  }

  private async computeEvaluation(offer: Offer, companyId: string): Promise<EvaluationResult> {
    // Fetch historical offers on this route (same country pair, with pricePerKm)
    const historical = await this.prisma.offer.findMany({
      where: {
        companyId,
        pickupCountry: offer.pickupCountry,
        deliveryCountry: offer.deliveryCountry,
        pricePerKm: { not: null },
        id: { not: offer.id },
      },
      select: { id: true, pricePerKm: true, currency: true, createdAt: true },
    });

    const routePopularity = historical.length;

    // The "market" average is in the offer's currency, converted through common/fx
    // (common/money.ts). Rates in different currencies are never averaged as they
    // are (2 EUR + 8 PLN + 1.5 GBP is not a number in any currency). A rate in a
    // currency without an exchange rate is left out and counted (decisions §4).
    const money = new MoneyInCompanyCurrency(offer.currency);
    const avgPricePerKm = money.average(
      historical.map((h, i) => ({ id: h.id ?? String(i), value: h.pricePerKm, currency: h.currency })),
    );

    // Zero is a value: a rate of 0 EUR/km, a margin of 0% and a price of 0 are real
    // numbers, not missing data. Read with `!= null`, never with `if (value)` (decisions §2).
    const offerPpkm = offer.pricePerKm != null ? Number(offer.pricePerKm) : null;
    const storedMargin = offer.profitMarginPercent != null ? Number(offer.profitMarginPercent) : null;
    // A margin without a toll is an upper bound: below 10 % it tells the truth
    // ("at most that"), from 10 % it is unknown — rated as an unknown margin.
    const boundUncertain = storedMargin !== null && offer.marginWithoutTolls === true && storedMargin >= 10;
    const margin = boundUncertain ? null : storedMargin;
    const price = offer.price != null ? Number(offer.price) : null;

    // priceVsMarket in %
    let priceVsMarket: number | null = null;
    // Two separate conditions on purpose: `!== null` checks that the data is PRESENT,
    // `!== 0` guards against division by zero. A combined `if (a && b)` would mix
    // the two and also drop a rate of 0 EUR/km.
    if (offerPpkm !== null && avgPricePerKm !== null && avgPricePerKm !== 0) {
      priceVsMarket = ((offerPpkm - avgPricePerKm) / avgPricePerKm) * 100;
    }

    // pricePerKmRating
    let pricePerKmRating: PricePerKmRating = 'unknown';
    if (priceVsMarket !== null) {
      if (priceVsMarket > 5) pricePerKmRating = 'above';
      else if (priceVsMarket < -5) pricePerKmRating = 'below';
      else pricePerKmRating = 'at';
    }

    // marginRating
    let marginRating: MarginRating = boundUncertain ? 'uncertain' : 'poor';
    if (margin !== null) {
      if (margin > 20) marginRating = 'excellent';
      else if (margin >= 10) marginRating = 'good';
      else if (margin >= 5) marginRating = 'fair';
    }

    // Score 1–10
    const score = this.calcScore(margin, priceVsMarket);

    // Recommendation text
    const recommendation = this.buildRecommendation(offer, price, offerPpkm, avgPricePerKm, margin, priceVsMarket, routePopularity, score);

    return {
      offerId: offer.id,
      route: `${offer.pickupCountry}→${offer.deliveryCountry}`,
      pickupCity: offer.pickupCity,
      pickupCountry: offer.pickupCountry,
      deliveryCity: offer.deliveryCity,
      deliveryCountry: offer.deliveryCountry,
      price,
      currency: offer.currency,
      score,
      priceVsMarket: priceVsMarket !== null ? Math.round(priceVsMarket * 10) / 10 : null,
      marginRating,
      pricePerKmRating,
      routePopularity,
      recommendation,
      calculatedAt: new Date().toISOString(),
      messages: money.summary().codes,
    };
  }

  private calcScore(margin: number | null, priceVsMarket: number | null): number {
    // Base from margin
    let base: number;
    if (margin === null) {
      base = 5; // unknown margin — neutral
    } else if (margin > 20) {
      base = 9;
    } else if (margin >= 15) {
      base = 8;
    } else if (margin >= 10) {
      base = 7;
    } else if (margin >= 5) {
      base = 5;
    } else if (margin >= 0) {
      base = 3;
    } else {
      base = 1;
    }

    // Adjust for market position
    let adj = 0;
    if (priceVsMarket !== null) {
      if (priceVsMarket > 15) adj = 1;
      else if (priceVsMarket > 5) adj = 0.5;
      else if (priceVsMarket < -10) adj = -1.5;
      else if (priceVsMarket < -5) adj = -0.5;
    }

    return Math.min(10, Math.max(1, Math.round(base + adj)));
  }

  private buildRecommendation(
    offer: Offer,
    price: number | null,
    offerPpkm: number | null,
    avgPpkm: number | null,
    margin: number | null,
    priceVsMarket: number | null,
    routePopularity: number,
    score: number,
  ): string {
    const parts: string[] = [];

    // Route + price intro
    const route = `${offer.pickupCity ?? offer.pickupCountry}→${offer.deliveryCity ?? offer.deliveryCountry}`;
    const priceStr = price != null ? `${price.toLocaleString('pl-PL')} ${offer.currency}` : 'brak ceny';
    const ppkmStr = offerPpkm != null ? `${offerPpkm.toFixed(2)} ${offer.currency}/km` : 'brak stawki';
    parts.push(`Oferta na trasie ${offer.pickupCountry}→${offer.deliveryCountry} (${route}) za ${priceStr} (${ppkmStr}).`);

    // Market comparison
    if (avgPpkm !== null && priceVsMarket !== null) {
      const dir = priceVsMarket >= 0 ? 'powyżej' : 'poniżej';
      const pct = Math.abs(priceVsMarket).toFixed(1);
      parts.push(`Stawka jest ${pct}% ${dir} średniej Twoich ofert (${avgPpkm.toFixed(2)} ${offer.currency}/km na tej trasie).`);
    } else if (routePopularity === 0) {
      parts.push('Brak historycznych danych dla tej trasy — pierwsza oferta na tym kierunku.');
    }

    // Margin
    if (margin !== null) {
      const marginDesc =
        margin > 20 ? 'doskonała opłacalność' :
        margin >= 15 ? 'dobra opłacalność' :
        margin >= 10 ? 'przeciętna opłacalność' :
        margin >= 5  ? 'słaba opłacalność' :
                       'bardzo słaba opłacalność';
      parts.push(`Marża ${margin.toFixed(1)}% — ${marginDesc}.`);
    }

    // Route popularity
    if (routePopularity >= 10) {
      parts.push(`Trasa popularna (${routePopularity} ofert w historii).`);
    } else if (routePopularity >= 3) {
      parts.push(`Trasa umiarkowanie znana (${routePopularity} ofert w historii).`);
    } else if (routePopularity > 0) {
      parts.push(`Trasa niszowa (${routePopularity} oferty w historii).`);
    }

    // Final recommendation
    let reco: string;
    if (score >= 8) reco = 'REKOMENDACJA: Zdecydowanie warto zaakceptować.';
    else if (score >= 6) reco = 'REKOMENDACJA: Warto zaakceptować.';
    else if (score >= 4) reco = 'REKOMENDACJA: Rozważ negocjację lepszej ceny.';
    else reco = 'REKOMENDACJA: Słabe warunki — rozważ odrzucenie lub renegocjację.';

    parts.push(reco);

    return parts.join(' ');
  }
}

import type { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { MoneyInCompanyCurrency, REVENUE_STATUSES, averageOf, companyCurrency } from '../common/money';

/** Offer row with its amount and currency — the input to the conversion in common/money.ts. */
const MONEY_SELECT = { id: true, price: true, pricePerKm: true, currency: true, createdAt: true } as const;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  async getRouteStats(
    companyId: string,
    pickupCountry: string,
    deliveryCountry: string,
    pickupPostal?: string,
    deliveryPostal?: string,
  ) {
    const cacheKey = MemoryCacheService.buildKey('route-stats', companyId, MemoryCacheService.hashQuery({ pickupCountry, deliveryCountry, pickupPostal, deliveryPostal }));
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const pickupPrefix = pickupPostal?.slice(0, 2);
    const deliveryPrefix = deliveryPostal?.slice(0, 2);

    const where: Prisma.OfferWhereInput = {
      companyId,
      pickupCountry,
      deliveryCountry,
      pricePerKm: { not: null },
      ...(pickupPrefix && { pickupPostal: { startsWith: pickupPrefix } }),
      ...(deliveryPrefix && { deliveryPostal: { startsWith: deliveryPrefix } }),
    };

    // Amounts are converted to the company currency in code (common/fx.ts); _avg/_min/_max in the database would mix currencies.
    const money = new MoneyInCompanyCurrency(await companyCurrency(this.prisma, companyId));
    const [rows, lastOffer, count] = await Promise.all([
      this.prisma.offer.findMany({ where, select: MONEY_SELECT }),
      this.prisma.offer.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.offer.count({ where }),
    ]);
    const perKmRow = (r: (typeof rows)[number]) => ({ id: r.id, value: r.pricePerKm, currency: r.currency });
    const perKm = money.amounts(rows.map(perKmRow));

    // Trend: compare last 30d avg vs prev 30d avg
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
    const perKmIn = (from: Date, to?: Date) => money.average(
      rows.filter(r => r.createdAt >= from && (!to || r.createdAt < to)).map(perKmRow),
    );

    let trend: 'up' | 'down' | 'stable' = 'stable';
    const recentAvg = perKmIn(d30) ?? 0;
    const prevAvg = perKmIn(d60, d30) ?? 0;
    if (recentAvg > 0 && prevAvg > 0) {
      const diff = (recentAvg - prevAvg) / prevAvg;
      if (diff > 0.03) trend = 'up';
      else if (diff < -0.03) trend = 'down';
    }

    // Average, minimum and maximum are `null` only when there are no amounts
    // (after conversion). A result of 0 is a value, not missing data.
    const result = {
      pickupCountry,
      deliveryCountry,
      avgPricePerKm: averageOf(perKm),
      minPricePerKm: perKm.length ? Math.min(...perKm) : null,
      maxPricePerKm: perKm.length ? Math.max(...perKm) : null,
      avgPrice: money.average(rows.map(r => ({ id: r.id, value: r.price, currency: r.currency }))),
      totalOffers: count,
      money: money.summary(),
      lastOfferDate: lastOffer?.createdAt ?? null,
      trend,
    };
    this.cache.set(cacheKey, result, 300);
    return result;
  }

  async getMarketOverview(companyId: string) {
    const cacheKey = MemoryCacheService.buildKey('market-overview', companyId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const money = new MoneyInCompanyCurrency(await companyCurrency(this.prisma, companyId));
    const [topRoutes, avgMargin, acceptedRows, thisMonth, lastMonth, marginUpperBoundOffers] = await Promise.all([
      // Top 5 routes by offer count
      this.prisma.offer.groupBy({
        by: ['pickupCountry', 'deliveryCountry'],
        where: { companyId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      // The average margin from full margins only (upper bounds without a toll — separately)
      this.prisma.offer.aggregate({
        where: { companyId, profitMarginPercent: { not: null }, marginWithoutTolls: false },
        _avg: { profitMarginPercent: true },
      }),
      // Jobs accepted, in transit and completed (REVENUE_STATUSES) with amount and
      // currency — revenue and months are computed in code.
      this.prisma.offer.findMany({
        where: { companyId, status: { in: [...REVENUE_STATUSES] }, price: { not: null } },
        select: MONEY_SELECT,
      }),
      // This month offers
      this.prisma.offer.count({
        where: { companyId, createdAt: { gte: startOfThisMonth } },
      }),
      // Last month offers
      this.prisma.offer.count({
        where: { companyId, createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      }),
      this.prisma.offer.count({ where: { companyId, profitMarginPercent: { not: null }, marginWithoutTolls: true } }),
    ]);

    // Monthly revenue for last 6 months
    const monthlyRevenue = await this.buildMonthlyRevenue(companyId, 6, acceptedRows, money);

    // Average price per km of each route — from the converted amounts of that route's offers.
    const routes = await Promise.all(topRoutes.map(async (r) => {
      const perKm = await this.prisma.offer.findMany({
        where: { companyId, pickupCountry: r.pickupCountry, deliveryCountry: r.deliveryCountry, pricePerKm: { not: null } },
        select: MONEY_SELECT,
      });
      return {
        pickupCountry: r.pickupCountry,
        deliveryCountry: r.deliveryCountry,
        offerCount: r._count.id,
        avgPricePerKm: money.average(perKm.map(o => ({ id: o.id, value: o.pricePerKm, currency: o.currency }))),
      };
    }));

    const result = {
      topRoutes: routes,
      avgMargin: avgMargin._avg.profitMarginPercent != null
        ? Number(avgMargin._avg.profitMarginPercent)
        : null,
      /** Offers with only an upper-bound margin (no toll) — outside the average. */
      marginUpperBoundOffers,
      totalRevenue: money.sum(acceptedRows.map(r => ({ id: r.id, value: r.price, currency: r.currency }))),
      offersThisMonth: thisMonth,
      offersLastMonth: lastMonth,
      monthlyRevenue,
      money: money.summary(),
    };
    this.cache.set(cacheKey, result, 300);
    return result;
  }

  /**
   * Monthly revenue in the company currency, from the accepted offers already
   * fetched. `offers` counts all offers created in that month, any status.
   */
  private async buildMonthlyRevenue(
    companyId: string,
    months: number,
    accepted: { id: string; price: Prisma.Decimal | null; currency: string; createdAt: Date }[],
    money: MoneyInCompanyCurrency,
  ) {
    const result: { month: string; revenue: number; offers: number }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const inMonth = accepted.filter(r => r.createdAt >= start && r.createdAt < end);
      const cnt = await this.prisma.offer.count({
        where: { companyId, createdAt: { gte: start, lt: end } },
      });

      result.push({
        month: start.toLocaleDateString('pl-PL', { month: 'short', year: '2-digit' }),
        revenue: money.sum(inMonth.map(r => ({ id: r.id, value: r.price, currency: r.currency }))),
        offers: cnt,
      });
    }

    return result;
  }
}

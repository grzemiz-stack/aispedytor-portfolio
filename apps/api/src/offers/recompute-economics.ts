import { TRUSTED_ROUTE } from '../common/route-trust';
import type { OfferStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { companyRate, economicsWithRate, type CompanyRate, type OfferEconomics } from './offer-economics';

/**
 * Recomputing the cost, profit and margin of existing offers
 * (docs/decisions.md §3a). The same rule as on save (`offer-economics.ts`):
 * the company cost per km **at today's rate** × km + toll, km and toll from
 * the latest planner route when there is one.
 *
 * - no scope — every offer, accepted and completed ones too: an old margin
 *   "from fuel" (the form, the seed) is a wrong number, not history;
 * - `companyId` + `statuses` — a company rate change recomputes its open
 *   offers (NEW, ASSIGNED);
 * - idempotent: written only where the result differs from what is stored —
 *   a second run changes nothing;
 * - `dryRun` — writes nothing, the same counts as a real run.
 */
export interface RecomputeCounts {
  offers: number;
  full: number;
  upperBound: number;
  empty: number;
  changed: number;
  /** Saved routes skipped as fallbacks (0 km or a flat 500 km — common/route-trust.ts). */
  suspectRoutes: number;
}

export interface RecomputeOptions {
  dryRun?: boolean;
  companyId?: string;
  statuses?: OfferStatus[];
  batchSize?: number;
}

type Prisma = Pick<PrismaService, 'offer' | 'company' | 'routeCalculation'>;

const FIELDS = ['totalCostEstimate', 'profitEstimate', 'profitMarginPercent', 'marginWithoutTolls'] as const;
const asNumber = (v: unknown) => (v == null ? null : typeof v === 'boolean' ? v : Number(v));

export async function recomputeEconomics(prisma: Prisma, opts: RecomputeOptions = {}): Promise<RecomputeCounts> {
  const counts: RecomputeCounts = { offers: 0, full: 0, upperBound: 0, empty: 0, changed: 0, suspectRoutes: 0 };
  const rates = new Map<string, CompanyRate>();
  const take = opts.batchSize ?? 500;
  let cursor: string | null = null;

  for (;;) {
    const batch = await prisma.offer.findMany({
      where: {
        ...(opts.companyId && { companyId: opts.companyId }),
        ...(opts.statuses && { status: { in: opts.statuses } }),
      },
      orderBy: { id: 'asc' },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true, companyId: true, price: true, currency: true, distanceKm: true, tollCostEstimate: true,
        totalCostEstimate: true, profitEstimate: true, profitMarginPercent: true, marginWithoutTolls: true,
      },
    });
    if (batch.length === 0) break;

    // The latest planner route of each offer in the batch — in one query.
    // Without suspected fallback routes — how many were skipped, the command output says.
    counts.suspectRoutes += await prisma.routeCalculation.count({
      where: { offerId: { in: batch.map((o) => o.id) }, NOT: TRUSTED_ROUTE },
    });
    const routes = await prisma.routeCalculation.findMany({
      where: { offerId: { in: batch.map((o) => o.id) }, ...TRUSTED_ROUTE },
      select: { offerId: true, distanceKm: true, tollTotalEur: true, calculatedAt: true },
    });
    const latest = new Map<string, (typeof routes)[number]>();
    for (const r of routes) {
      const seen = latest.get(r.offerId);
      if (!seen || r.calculatedAt > seen.calculatedAt) latest.set(r.offerId, r);
    }

    for (const o of batch) {
      let rate = rates.get(o.companyId);
      if (!rate) {
        rate = await companyRate(prisma, o.companyId);
        rates.set(o.companyId, rate);
      }
      const route = latest.get(o.id);
      const next: OfferEconomics = economicsWithRate(
        {
          price: o.price == null ? null : Number(o.price),
          currency: o.currency,
          distanceKm: o.distanceKm,
          tollCostEstimate: o.tollCostEstimate == null ? null : Number(o.tollCostEstimate),
        },
        rate,
        // A route without a toll quote (null) stays "no toll" — an upper bound.
        route ? { distanceKm: route.distanceKm, tollEUR: route.tollTotalEur == null ? null : Number(route.tollTotalEur) } : null,
      );
      counts.offers += 1;
      if (next.profitMarginPercent == null) counts.empty += 1;
      else if (next.marginWithoutTolls) counts.upperBound += 1;
      else counts.full += 1;

      const changed = FIELDS.some((f) => asNumber(o[f]) !== next[f]);
      if (!changed) continue;
      counts.changed += 1;
      if (!opts.dryRun) await prisma.offer.update({ where: { id: o.id }, data: next });
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < take) break;
  }
  return counts;
}

/** `offers:recompute-economics [--dry-run]` — an unknown argument is an error, not a silent full run. */
export function parseRecomputeArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${a} (only --dry-run)`);
  }
  return { dryRun };
}

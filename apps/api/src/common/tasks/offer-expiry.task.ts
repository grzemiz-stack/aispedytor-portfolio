import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MemoryCacheService } from '../cache/memory-cache.service';
import { deadReason, MAX_OFFER_AGE_DAYS, type DeadReason } from '../../ltl-matching/offer-compatibility';

/** Candidates per page — a first run on a large database does not read everything in one query. */
const PAGE = 1000;

/**
 * NEW offers dead by the LTL rule → EXPIRED (docs/decisions.md §6): `expiresAt`
 * passed, older than 7 days, or the loading day before today in the pickup
 * country's zone (a country outside the map → the company country). ASSIGNED
 * is left alone — a dispatcher is working on it. No notifications and no
 * reason stored in the database; the reasons are counted in the log.
 */
@Injectable()
export class OfferExpiryTask {
  private readonly logger = new Logger(OfferExpiryTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  @Cron('0 * * * *') // Every hour
  async handleExpiry() {
    const now = new Date();
    const byReason: Record<DeadReason, number> = { EXPIRED: 0, TOO_OLD: 0, PICKUP_PASSED: 0 };
    const companies = new Set<string>();
    let expired = 0;
    let cursor: string | null = null;

    for (;;) {
      // Candidates with a margin but no gaps: a loading day before today in
      // any zone means a loading instant before `now`. Exactly — `deadReason`.
      const page = await this.prisma.offer.findMany({
        where: {
          // Pages by `id > the last id`, not a Prisma cursor: the cursor row has
          // just become EXPIRED, no longer matches `where`, and `skip: 1` then
          // swallowed the next offer.
          ...(cursor && { id: { gt: cursor } }),
          status: 'NEW',
          OR: [
            { expiresAt: { lte: now } },
            { createdAt: { lt: new Date(now.getTime() - MAX_OFFER_AGE_DAYS * 86_400_000) } },
            { pickupDate: { lt: now } },
          ],
        },
        select: {
          id: true, companyId: true, pickupCountry: true, pickupDate: true, createdAt: true, expiresAt: true,
          company: { select: { country: true } },
        },
        orderBy: { id: 'asc' },
        take: PAGE,
      });

      const dead = page.flatMap((o) => {
        const reason = deadReason(o, { now, companyCountry: o.company?.country ?? null });
        return reason ? [{ id: o.id, companyId: o.companyId, reason }] : [];
      });
      if (dead.length) {
        // Only while NEW: an offer assigned meanwhile does not expire.
        const result = await this.prisma.offer.updateMany({
          where: { id: { in: dead.map((d) => d.id) }, status: 'NEW' },
          data: { status: 'EXPIRED' },
        });
        expired += result.count;
        for (const d of dead) {
          byReason[d.reason]++;
          companies.add(d.companyId);
        }
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }

    // The offer list is cached for 30 s — cleared as on any other status change.
    for (const companyId of companies) this.cache.deleteByPrefix(`offers:${companyId}`);
    if (expired > 0) {
      this.logger.log(
        `[OfferExpiry] Expired ${expired} offers (EXPIRED ${byReason.EXPIRED}, TOO_OLD ${byReason.TOO_OLD}, PICKUP_PASSED ${byReason.PICKUP_PASSED})`,
      );
    }
  }
}

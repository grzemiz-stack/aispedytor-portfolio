import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDemandDto } from './dto/create-demand.dto';
import { UpdateDemandDto } from './dto/update-demand.dto';
import { PaginationDto, buildPaginatedResponse } from '../common/dto/pagination.dto';
import {
  matchOfferToDemand,
  MatchCriterionName,
  type OfferLike,
} from './match-offer-to-demand';
import {
  MATCHABLE_OFFER_STATUSES,
  isMatchableOfferStatus,
} from './matchable-offer-status';

/**
 * How many offers to load from the database for evaluation in memory. The domain
 * criteria are not part of the SQL query, so this is a SCAN limit, not a result limit.
 */
const SEARCH_SCAN_LIMIT = 500;

/** How many matched offers to return to the user. */
const SEARCH_RESULT_LIMIT = 50;

@Injectable()
export class DemandsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, pagination: PaginationDto, dispatcherId?: string) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const where = { companyId, ...(dispatcherId && { dispatcherId }) };

    const [data, total] = await Promise.all([
      this.prisma.dispatcherDemand.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatcherDemand.count({ where }),
    ]);

    // `matchCount` is not stored in the database — it is computed here from the current
    // offers. Offers are loaded once per list page, not once per demand.
    const withCounts = await this.withMatchCounts(companyId, data);

    return buildPaginatedResponse(withCounts, total, page, limit);
  }

  /**
   * Adds to each demand the number of currently matching offers.
   *
   * Uses the same predicate and status range as the manual search and
   * auto-notifications, over the same 500 newest offers as the manual search, so the
   * number on the list matches what the user sees after clicking the search button.
   * The count is not capped; the search returns at most SEARCH_RESULT_LIMIT offers.
   */
  private async withMatchCounts<T extends { id: string }>(
    companyId: string,
    demands: T[],
  ): Promise<Array<T & { matchCount: number }>> {
    if (demands.length === 0) return [];

    const offers = await this.prisma.offer.findMany({
      where: { companyId, status: { in: [...MATCHABLE_OFFER_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_SCAN_LIMIT,
    });

    return demands.map((demand) => ({
      ...demand,
      matchCount: offers.reduce(
        (count, offer) => (matchOfferToDemand(offer, demand).matches ? count + 1 : count),
        0,
      ),
    }));
  }

  async findOne(id: string, companyId: string) {
    const d = await this.prisma.dispatcherDemand.findFirst({ where: { id, companyId } });
    if (!d) throw new NotFoundException('Zapotrzebowanie nie znalezione');
    return d;
  }

  create(companyId: string, dispatcherId: string, dto: CreateDemandDto) {
    return this.prisma.dispatcherDemand.create({
      data: {
        companyId,
        dispatcherId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'MEDIUM',
        neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
        vehicleType: dto.vehicleType,
        trailerType: dto.trailerType,
        minLoadingMeters: dto.minLoadingMeters,
        maxWeight: dto.maxWeight,
        temperatureRequired: dto.temperatureRequired ?? false,
        temperatureMin: dto.temperatureMin,
        temperatureMax: dto.temperatureMax,
        adrRequired: dto.adrRequired ?? false,
        adrClass: dto.adrClass,
        preferredCountries: dto.preferredCountries ?? [],
        regions: dto.regions ?? [],
      },
    });
  }

  async update(id: string, companyId: string, dto: UpdateDemandDto) {
    await this.findOne(id, companyId);
    return this.prisma.dispatcherDemand.update({
      where: { id, companyId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.neededBy !== undefined && { neededBy: dto.neededBy ? new Date(dto.neededBy) : null }),
        ...(dto.vehicleType !== undefined && { vehicleType: dto.vehicleType }),
        ...(dto.trailerType !== undefined && { trailerType: dto.trailerType }),
        ...(dto.minLoadingMeters !== undefined && { minLoadingMeters: dto.minLoadingMeters }),
        ...(dto.maxWeight !== undefined && { maxWeight: dto.maxWeight }),
        ...(dto.temperatureRequired !== undefined && { temperatureRequired: dto.temperatureRequired }),
        ...(dto.temperatureMin !== undefined && { temperatureMin: dto.temperatureMin }),
        ...(dto.temperatureMax !== undefined && { temperatureMax: dto.temperatureMax }),
        ...(dto.adrRequired !== undefined && { adrRequired: dto.adrRequired }),
        ...(dto.adrClass !== undefined && { adrClass: dto.adrClass }),
        ...(dto.preferredCountries !== undefined && { preferredCountries: dto.preferredCountries }),
        ...(dto.regions !== undefined && { regions: dto.regions }),
      },
    });
  }

  async delete(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.dispatcherDemand.delete({ where: { id, companyId } });
  }

  // ── Search matching offers ──────────────────────────────────────────────

  async searchOffers(id: string, companyId: string, userId: string) {
    const demand = await this.findOne(id, companyId);

    // SQL filters only by scope: company and offer status.
    // The domain criteria are evaluated by matchOfferToDemand — the same function the
    // auto-notification path uses, so both results agree by definition.
    const candidates = await this.prisma.offer.findMany({
      where: {
        companyId,
        status: { in: [...MATCHABLE_OFFER_STATUSES] },
      },
      include: {
        contractor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_SCAN_LIMIT,
    });

    const matched: Array<(typeof candidates)[number] & { matchUnknownCriteria: MatchCriterionName[] }> = [];
    const unknownCriteriaSummary: Partial<Record<MatchCriterionName, number>> = {};

    for (const offer of candidates) {
      const result = matchOfferToDemand(offer, demand);
      if (!result.matches) continue;

      for (const criterion of result.unknownCriteria) {
        unknownCriteriaSummary[criterion] = (unknownCriteriaSummary[criterion] ?? 0) + 1;
      }

      matched.push({ ...offer, matchUnknownCriteria: result.unknownCriteria });
      if (matched.length >= SEARCH_RESULT_LIMIT) break;
    }

    // Update demand stats
    await this.prisma.dispatcherDemand.update({
      where: { id, companyId },
      data: {
        lastSearchAt: new Date(),
        status: demand.status === 'OPEN' ? 'IN_PROGRESS' : demand.status,
      },
    });

    // Create notification if matches found
    if (matched.length > 0) {
      await this.prisma.notification.create({
        data: {
          companyId,
          userId,
          type: 'DEMAND_MATCH',
          title: `Znaleziono ${matched.length} ofert`,
          message: `Zapotrzebowanie "${demand.title}" — znaleziono ${matched.length} pasujących ofert`,
        },
      });
    }

    return {
      demandId: id,
      matchCount: matched.length,
      offers: matched,
      unknownCriteriaSummary,
      scanned: candidates.length,
      scanLimitReached: candidates.length >= SEARCH_SCAN_LIMIT,
    };
  }

  // ── Subscribe for auto-notifications ────────────────────────────────────

  async toggleSubscription(id: string, companyId: string) {
    const demand = await this.findOne(id, companyId);
    const updated = await this.prisma.dispatcherDemand.update({
      where: { id, companyId },
      data: { autoNotify: !demand.autoNotify },
    });
    return { autoNotify: updated.autoNotify };
  }

  // ── Check new offer against active demands (called from offers service) ──

  async checkNewOfferAgainstDemands(
    companyId: string,
    offer: OfferLike & { id: string },
  ): Promise<Array<{ demandId: string; unknownCriteria: MatchCriterionName[] }>> {
    // The same status range as the manual search — an offer that is closed,
    // rejected or in transit does not create a match notification.
    if (!isMatchableOfferStatus(offer?.status)) return [];

    const demands = await this.prisma.dispatcherDemand.findMany({
      where: {
        companyId,
        autoNotify: true,
        isActive: true,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    });

    const notified: Array<{ demandId: string; unknownCriteria: MatchCriterionName[] }> = [];

    for (const demand of demands) {
      const result = matchOfferToDemand(offer, demand);
      if (!result.matches) continue;

      // Create notification for the dispatcher
      await this.prisma.notification.create({
        data: {
          companyId,
          userId: demand.dispatcherId,
          type: 'DEMAND_MATCH',
          title: `Nowa oferta pasuje do "${demand.title}"`,
          message: `${offer.pickupCity}, ${offer.pickupCountry} → ${offer.deliveryCity}, ${offer.deliveryCountry}${offer.price ? ` | ${offer.price} ${offer.currency}` : ''}`,
          offerId: offer.id,
        },
      });

      notified.push({ demandId: demand.id, unknownCriteria: result.unknownCriteria });
    }

    return notified;
  }
}

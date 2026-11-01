import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { msg } from '../common/plan-messages';
import { MoneyInCompanyCurrency, REVENUE_STATUSES, companyCurrency, isRevenueStatus } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { resolveSourceKey } from './raw-offer';
import { checkImportRow, type ImportRejection } from './import-row';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import type { ImportOffersDto } from './dto/import-offers.dto';
import { PaginationDto, buildPaginatedResponse } from '../common/dto/pagination.dto';
import { pricePerKmOf } from './price-per-km';
import { companyRate, economicsFor, economicsWithRate, previewEconomics, trustedRoute, type EconomicsInput } from './offer-economics';
import type { OfferEconomicsPreviewDto } from './dto/offer-economics-preview.dto';
import { DemandsService } from '../demands/demands.service';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { OfferSource, OfferStatus, type Offer, type Prisma } from '@prisma/client';
import { GeocodingService } from '../geocoding/geocoding.service';
import { deadReason } from '../ltl-matching/offer-compatibility';
import { countryTimeZone } from '../common/country-timezone';

/**
 * Whether an edit changes the place of a route end. The same rules as the save
 * in `update` (an empty field is no change) and the same key as the geocoding
 * cache (" Poznań, PL" = "poznań, pl").
 */
function placeChanged(
  oldCity: string, oldCountry: string | null,
  newCity: string | undefined, newCountry: string | undefined,
): boolean {
  const key = (city: string, country: string | null) =>
    `${GeocodingService.normalize(city)}|${GeocodingService.normalize(country ?? '')}`;
  return key(newCity || oldCity, newCountry || oldCountry) !== key(oldCity, oldCountry);
}

/**
 * Money, date and place fields — in a revenue status only an ADMIN changes
 * them (decisions §3a). Notes, contact and the rest — anyone.
 */
export const OFFER_LOCKED_FIELDS = [
  'price', 'currency', 'distanceKm', 'tollCostEstimate', 'pickupDate', 'deliveryDate', 'expiresAt',
  'pickupCity', 'pickupCountry', 'deliveryCity', 'deliveryCountry',
] as const;

type LockedChange = { field: (typeof OFFER_LOCKED_FIELDS)[number]; from: unknown; to: unknown };

/**
 * Which locked fields the PATCH body really changes — the same rules as saving
 * in `update` (an empty city, country, loading date, currency = no change;
 * `null` in price, distance, toll, unloading date, validity = clear). A form
 * may send everything: the same value is not a change.
 */
export function lockedFieldChanges(
  current: {
    price: unknown; currency: string; distanceKm: number | null; tollCostEstimate: unknown; pickupDate: Date; deliveryDate: Date | null; expiresAt: Date | null;
    pickupCity: string; pickupCountry: string; deliveryCity: string; deliveryCountry: string;
  },
  dto: UpdateOfferDto,
): LockedChange[] {
  const num = (v: unknown) => (v == null ? null : Number(v));
  const time = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : null);
  const out: LockedChange[] = [];
  const add = (field: LockedChange['field'], from: unknown, to: unknown) => out.push({ field, from, to });
  if (dto.price !== undefined && num(dto.price) !== num(current.price)) add('price', num(current.price), num(dto.price));
  if (dto.currency && dto.currency !== current.currency) add('currency', current.currency, dto.currency);
  if (dto.distanceKm !== undefined && num(dto.distanceKm) !== num(current.distanceKm)) add('distanceKm', current.distanceKm, num(dto.distanceKm));
  if (dto.tollCostEstimate !== undefined && num(dto.tollCostEstimate) !== num(current.tollCostEstimate)) {
    add('tollCostEstimate', num(current.tollCostEstimate), num(dto.tollCostEstimate));
  }
  if (dto.pickupDate && time(dto.pickupDate) !== time(current.pickupDate)) add('pickupDate', current.pickupDate.toISOString(), dto.pickupDate);
  // The unloading date: `null` = clear (as saving in `update`).
  if (dto.deliveryDate !== undefined && time(dto.deliveryDate) !== time(current.deliveryDate)) {
    add('deliveryDate', current.deliveryDate?.toISOString() ?? null, dto.deliveryDate ?? null);
  }
  if (dto.expiresAt !== undefined && time(dto.expiresAt) !== time(current.expiresAt)) {
    add('expiresAt', current.expiresAt?.toISOString() ?? null, dto.expiresAt ?? null);
  }
  for (const f of ['pickupCity', 'pickupCountry', 'deliveryCity', 'deliveryCountry'] as const) {
    if (dto[f] && dto[f] !== current[f]) add(f, current[f], dto[f]);
  }
  return out;
}

/**
 * The offer's economics input after an edit: the field from the body or the
 * current one. One place for saving (`update`) and the preview with
 * `offerId` — preview = save.
 */
function editedEconomicsInput(
  current: { id: string; price: unknown; currency: string; distanceKm: number | null; tollCostEstimate: unknown },
  dto: Pick<UpdateOfferDto, 'price' | 'currency' | 'distanceKm' | 'tollCostEstimate'>,
): EconomicsInput {
  return {
    id: current.id,
    price: dto.price !== undefined ? dto.price : current.price == null ? null : Number(current.price),
    currency: dto.currency || current.currency,
    distanceKm: dto.distanceKm !== undefined ? dto.distanceKm : current.distanceKm,
    tollCostEstimate: dto.tollCostEstimate !== undefined
      ? dto.tollCostEstimate
      : current.tollCostEstimate == null ? null : Number(current.tollCostEstimate),
  };
}

/** Columns the offer list may be sorted by (the web table sends `sortBy`). */
export const OFFER_SORT_COLUMNS = ['createdAt', 'price', 'distanceKm', 'pickupDate', 'pricePerKm', 'profitMarginPercent'] as const;
const NULLABLE_SORT_COLUMNS = new Set<string>(['price', 'distanceKm', 'pricePerKm', 'profitMarginPercent']);

/**
 * `contractorBlacklisted` for the screens (the list, the offer page): only a
 * contractor of the SAME company as the offer; the helper fields are not sent.
 * `updateStatus` decides anyway (a query in the caller's company).
 */
function withBlacklistFlag<T extends { companyId: string; contractor: { isBlacklisted: boolean; companyId: string } | null }>(offer: T) {
  const { contractor, ...rest } = offer;
  const visible = contractor ? (({ isBlacklisted: _b, companyId: _c, ...c }) => c)(contractor) : null;
  return {
    ...rest,
    contractor: visible as Omit<NonNullable<T['contractor']>, 'isBlacklisted' | 'companyId'> | null,
    contractorBlacklisted: contractor?.isBlacklisted === true && contractor.companyId === offer.companyId,
  };
}

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DemandsService))
    private readonly demandsService: DemandsService,
    private readonly cache: MemoryCacheService,
    private readonly taskQueue: TaskQueueService,
  ) {}

  async findAll(companyId: string, pagination: PaginationDto, filters?: { status?: OfferStatus; assignedToId?: string; source?: OfferSource }) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const sortBy = (OFFER_SORT_COLUMNS as readonly string[]).includes(pagination.sortBy ?? '') ? pagination.sortBy! : 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';
    // Nullable columns: empty values last in both directions (Postgres would put them first on desc).
    // The margin: full ones, then upper bounds (without tolls), empty last — in
    // both directions. `marginWithoutTolls`: false < true, NULL last.
    const orderBy = sortBy === 'profitMarginPercent'
      ? [{ marginWithoutTolls: { sort: 'asc' as const, nulls: 'last' as const } }, { profitMarginPercent: { sort: sortOrder, nulls: 'last' as const } }]
      : NULLABLE_SORT_COLUMNS.has(sortBy) ? { [sortBy]: { sort: sortOrder, nulls: 'last' as const } } : { [sortBy]: sortOrder };

    const cacheKey = MemoryCacheService.buildKey('offers', companyId, MemoryCacheService.hashQuery({ page, limit, sortBy, sortOrder, ...filters }));
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const where = {
      companyId,
      ...(filters?.status && { status: filters.status }),
      ...(filters?.assignedToId && { assignedToId: filters.assignedToId }),
      ...(filters?.source && { source: filters.source }),
    };

    const [data, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        include: {
          contractor: { select: { id: true, name: true, country: true, isBlacklisted: true, companyId: true } },
          assignedTo: { select: { id: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.offer.count({ where }),
    ]);

    const result = buildPaginatedResponse(data.map(withBlacklistFlag), total, page, limit);
    this.cache.set(cacheKey, result, 30);
    return result;
  }

  async findOne(id: string, companyId: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, companyId },
      include: {
        contractor: { select: { name: true, country: true, isBlacklisted: true, companyId: true } },
        assignedTo: { select: { id: true } },
      },
    });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');
    return withBlacklistFlag(offer);
  }

  /** The economics fields of a new offer — the same defaults as `create` (preview = save). */
  private static newOfferEconomicsInput(dto: OfferEconomicsPreviewDto): EconomicsInput {
    return {
      price: dto.price ?? null,
      currency: dto.currency || 'EUR',
      distanceKm: dto.distanceKm ?? null,
      tollCostEstimate: dto.tollCostEstimate ?? null,
    };
  }

  /**
   * The margin preview in the form: exactly what saving computes. Without
   * `offerId` — a new offer, as `create` (no route). With `offerId` — an edit,
   * as `update`: missing fields from the offer, its saved route
   * (TRUSTED_ROUTE), the offer only of the caller's company (decisions §3a).
   */
  async economicsPreview(companyId: string, dto: OfferEconomicsPreviewDto) {
    const rate = await companyRate(this.prisma, companyId);
    if (!dto.offerId) return previewEconomics(OffersService.newOfferEconomicsInput(dto), rate);
    const current = await this.findOne(dto.offerId, companyId);
    return previewEconomics(editedEconomicsInput(current, dto), rate, await trustedRoute(this.prisma, current.id));
  }

  async create(companyId: string, dto: CreateOfferDto) {
    // The contractor must belong to the caller's company — otherwise the offer
    // could point to another company's contractor and findOne would show its
    // name and country.
    if (dto.contractorId) {
      const contractor = await this.prisma.contractor.findFirst({
        where: { id: dto.contractorId, companyId },
        select: { id: true },
      });
      if (!contractor) {
        const m = msg('OFFER_CONTRACTOR_NOT_FOUND');
        throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
      }
    }
    // Cost, profit and margin through offerCost.
    const economics = await economicsFor(this.prisma, companyId, OffersService.newOfferEconomicsInput(dto));
    const offer = await this.prisma.offer.create({
      data: {
        companyId,
        source: dto.source ?? OfferSource.MANUAL,
        ...economics,
        pickupCity: dto.pickupCity,
        pickupCountry: dto.pickupCountry,
        pickupPostal: dto.pickupPostal,
        deliveryCity: dto.deliveryCity,
        deliveryCountry: dto.deliveryCountry,
        deliveryPostal: dto.deliveryPostal,
        pickupDate: new Date(dto.pickupDate),
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        cargoType: dto.cargoType,
        weightKg: dto.weightKg,
        volumeM3: dto.volumeM3,
        lengthM: dto.lengthM,
        isAdr: dto.isAdr || false,
        adrClass: dto.adrClass,
        isFrigo: dto.isFrigo || false,
        temperatureMin: dto.temperatureMin,
        temperatureMax: dto.temperatureMax,
        price: dto.price,
        currency: dto.currency || 'EUR',
        pricePerKm: pricePerKmOf(dto.price, dto.distanceKm),
        distanceKm: dto.distanceKm,
        fuelCostEstimate: dto.fuelCostEstimate,
        tollCostEstimate: dto.tollCostEstimate,
        notes: dto.notes,
        clientName: dto.clientName,
        contractorId: dto.contractorId,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        externalId: dto.externalId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        penaltyClauses: dto.penaltyClauses,
        loadingTimeWindow: dto.loadingTimeWindow,
        unloadingTimeWindow: dto.unloadingTimeWindow,
        palletExchange: dto.palletExchange ?? false,
        palletExchangeType: dto.palletExchangeType,
        palletCount: dto.palletCount,
        requiredInsuranceMin: dto.requiredInsuranceMin,
        paymentTermDays: dto.paymentTermDays,
        specialRequirements: dto.specialRequirements,
      },
    });

    this.afterOfferCreated(companyId, offer);
    return offer;
  }

  /**
   * What a new offer sets off — matching against active demands (notifications)
   * and clearing the cached offer list. Every place that creates a single
   * offer calls it: the form and the e-mail (after its transaction commits).
   * The import does the same in bulk.
   */
  afterOfferCreated(companyId: string, offer: Offer): void {
    this.queueDemandMatching(companyId, offer);
    this.invalidateOfferCache(companyId);
  }

  async update(id: string, companyId: string, dto: UpdateOfferDto, actor: { userId: string; role: string } | null = null) {
    const current = await this.findOne(id, companyId);
    // The source and the external id are the offer's origin and its import key
    // (company + source + externalId) — not editable; the same value passes (a
    // form may send everything) (decisions §3a).
    for (const [field, changed] of [
      ['source', dto.source !== undefined && dto.source !== current.source],
      ['externalId', dto.externalId !== undefined && (dto.externalId || null) !== current.externalId],
    ] as const) {
      if (changed) {
        const m = msg('OFFER_FIELD_NOT_EDITABLE', { field });
        throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
      }
    }
    // An accepted, in-transit or completed offer: money, dates and places are
    // changed by an ADMIN only, and the change is logged (decisions §3a).
    if (isRevenueStatus(current.status)) this.assertLockedFields(current, dto, actor);
    // The offer's contractor (decisions §3b): `null` or empty — no contractor.
    const contractorChanged = dto.contractorId !== undefined && (dto.contractorId || null) !== current.contractorId;
    if (contractorChanged) await this.assertContractorChange(current, companyId, dto.contractorId || null, actor);
    // A changed place (city or country — OfferGeocodingTask geocodes by them)
    // invalidates that end's coordinates: the offer waits for new ones
    // (awaitingLocation) instead of a detour from the old place.
    // `coordsCheckedAt` is cleared because the task skips recently checked offers.
    const pickupMoved = placeChanged(current.pickupCity, current.pickupCountry, dto.pickupCity, dto.pickupCountry);
    const deliveryMoved = placeChanged(current.deliveryCity, current.deliveryCountry, dto.deliveryCity, dto.deliveryCountry);
    // A new price or distance → the rate per km again from the values after the change.
    const rateChanged = dto.price !== undefined || dto.distanceKm !== undefined;
    const input = editedEconomicsInput(current, dto);
    const { price, distanceKm } = input;
    // Price, currency, distance or manual toll → cost, profit and margin again
    // through offerCost, with the planner route when there is one.
    const economicsChanged = rateChanged || dto.currency !== undefined || dto.tollCostEstimate !== undefined;
    const economics = economicsChanged ? await economicsFor(this.prisma, companyId, input) : null;
    this.invalidateOfferCache(companyId);
    return this.prisma.offer.update({
      where: { id, companyId },
      data: {
        ...(dto.pickupCity && { pickupCity: dto.pickupCity }),
        ...(dto.pickupCountry && { pickupCountry: dto.pickupCountry }),
        ...(dto.pickupPostal !== undefined && { pickupPostal: dto.pickupPostal }),
        ...(dto.deliveryCity && { deliveryCity: dto.deliveryCity }),
        ...(dto.deliveryCountry && { deliveryCountry: dto.deliveryCountry }),
        ...(dto.deliveryPostal !== undefined && { deliveryPostal: dto.deliveryPostal }),
        ...(dto.pickupDate && { pickupDate: new Date(dto.pickupDate) }),
        ...(dto.deliveryDate !== undefined && { deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null }),
        // Offer validity: a date, or null = no deadline.
        ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }),
        ...(dto.cargoType !== undefined && { cargoType: dto.cargoType }),
        ...(dto.weightKg !== undefined && { weightKg: dto.weightKg }),
        ...(dto.volumeM3 !== undefined && { volumeM3: dto.volumeM3 }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.distanceKm !== undefined && { distanceKm: dto.distanceKm }),
        ...(rateChanged && { pricePerKm: pricePerKmOf(price, distanceKm) }),
        ...economics,
        ...(dto.fuelCostEstimate !== undefined && { fuelCostEstimate: dto.fuelCostEstimate }),
        ...(dto.tollCostEstimate !== undefined && { tollCostEstimate: dto.tollCostEstimate }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.clientName !== undefined && { clientName: dto.clientName }),
        ...(dto.contactEmail !== undefined && { contactEmail: dto.contactEmail }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
        ...(contractorChanged && { contractorId: dto.contractorId || null }),
        // Cargo, conditions and requirements — accepted by the DTO and silently
        // dropped before (decisions §3a). `null` clears; the flags (columns
        // without null) — `null` = false.
        ...(dto.lengthM !== undefined && { lengthM: dto.lengthM }),
        ...(dto.isAdr !== undefined && { isAdr: dto.isAdr ?? false }),
        ...(dto.adrClass !== undefined && { adrClass: dto.adrClass || null }),
        ...(dto.isFrigo !== undefined && { isFrigo: dto.isFrigo ?? false }),
        ...(dto.temperatureMin !== undefined && { temperatureMin: dto.temperatureMin }),
        ...(dto.temperatureMax !== undefined && { temperatureMax: dto.temperatureMax }),
        ...(dto.penaltyClauses !== undefined && { penaltyClauses: dto.penaltyClauses || null }),
        ...(dto.loadingTimeWindow !== undefined && { loadingTimeWindow: dto.loadingTimeWindow }),
        ...(dto.unloadingTimeWindow !== undefined && { unloadingTimeWindow: dto.unloadingTimeWindow }),
        ...(dto.palletExchange !== undefined && { palletExchange: dto.palletExchange ?? false }),
        ...(dto.palletExchangeType !== undefined && { palletExchangeType: dto.palletExchangeType || null }),
        ...(dto.palletCount !== undefined && { palletCount: dto.palletCount }),
        ...(dto.requiredInsuranceMin !== undefined && { requiredInsuranceMin: dto.requiredInsuranceMin }),
        ...(dto.paymentTermDays !== undefined && { paymentTermDays: dto.paymentTermDays }),
        ...(dto.specialRequirements !== undefined && { specialRequirements: dto.specialRequirements || null }),
        ...(pickupMoved && { pickupLat: null, pickupLng: null }),
        ...(deliveryMoved && { deliveryLat: null, deliveryLng: null }),
        ...((pickupMoved || deliveryMoved) && { coordsCheckedAt: null }),
      },
    });
  }

  async assign(id: string, companyId: string, userId: string) {
    await this.findOne(id, companyId);
    // `userId` comes from the URL — only an active user of the same company.
    // 404 without telling "does not exist" from "another company": other
    // companies' ids are not revealed.
    const assignee = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      const m = msg('OFFER_ASSIGNEE_NOT_FOUND');
      throw new NotFoundException({ statusCode: 404, ...m, message: m.code });
    }
    this.invalidateOfferCache(companyId);
    return this.prisma.offer.update({
      where: { id, companyId },
      data: { assignedToId: userId, assignedAt: new Date(), status: 'ASSIGNED' },
    });
  }

  /**
   * `actor` — who changes the status (from the token). Without it, accepting an
   * offer from a blacklisted contractor is treated as by a non-ADMIN.
   */
  async updateStatus(id: string, companyId: string, status: OfferStatus, actor: { userId: string; role: string } | null = null) {
    // ASSIGNED without a person is untrue — assigning only through `assign`.
    if (status === 'ASSIGNED') {
      const m = msg('OFFER_ASSIGN_VIA_ASSIGN');
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }
    const current = await this.findOne(id, companyId);
    // Every way into a revenue status from a non-revenue one — not only ACCEPTED
    // (NEW → IN_TRANSIT / COMPLETED skipped the rule; decisions §3b).
    if (isRevenueStatus(status) && !isRevenueStatus(current.status)) await this.assertAcceptable(current, companyId, actor);
    if (status === 'NEW' && (current.status === 'EXPIRED' || current.status === 'REJECTED')) {
      await this.assertRestorable(current, companyId);
    }
    this.invalidateOfferCache(companyId);
    // Back to NEW = nobody handles it: the person is cleared. Later statuses
    // (ACCEPTED, IN_TRANSIT…) keep whoever handles it.
    return this.prisma.offer.update({
      where: { id, companyId },
      data: status === 'NEW' ? { status, assignedToId: null, assignedAt: null } : { status },
    });
  }

  /**
   * The blacklist on acceptance: the contractor is looked up in the caller's
   * company — a contractor of another company does not count. Not an ADMIN →
   * 400 OFFER_CONTRACTOR_BLACKLISTED; an ADMIN may, and the acceptance goes to
   * the log: who, when, the offer, the contractor. Offers accepted before stay
   * as they were.
   */
  private async assertAcceptable(
    offer: { id: string; contractorId: string | null },
    companyId: string,
    actor: { userId: string; role: string } | null,
  ): Promise<void> {
    if (!offer.contractorId) return;
    const contractor = await this.prisma.contractor.findFirst({
      where: { id: offer.contractorId, companyId },
      select: { id: true, name: true, isBlacklisted: true },
    });
    if (!contractor?.isBlacklisted) return;
    if (actor?.role !== 'ADMIN') {
      const m = msg('OFFER_CONTRACTOR_BLACKLISTED');
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }
    this.logger.warn(
      `Offer ${offer.id} accepted despite blacklisted contractor ${contractor.id} (${contractor.name}) ` +
        `by user ${actor.userId} (ADMIN) at ${new Date().toISOString()}`,
    );
  }

  /**
   * Locked fields in a revenue status: a role other than ADMIN → 403
   * OFFER_FIELDS_ADMIN_ONLY { fields }; an ADMIN — a log line (who, field, from → to).
   */
  private assertLockedFields(
    current: Parameters<typeof lockedFieldChanges>[0] & { id: string; status: string },
    dto: UpdateOfferDto,
    actor: { userId: string; role: string } | null,
  ): void {
    const changes = lockedFieldChanges(current, dto);
    if (changes.length === 0) return;
    if (actor?.role !== 'ADMIN') {
      const m = msg('OFFER_FIELDS_ADMIN_ONLY', { fields: changes.map((c) => c.field).join(', ') });
      throw new ForbiddenException({ statusCode: 403, ...m, message: m.code });
    }
    this.logger.warn(
      `Offer ${current.id} (${current.status}) changed by user ${actor.userId} (ADMIN) at ${new Date().toISOString()}: ` +
        changes.map((c) => `${c.field} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; '),
    );
  }

  /**
   * Changing the offer's contractor: the new one only from the caller's
   * company (as on create); detaching or replacing a contractor on this
   * company's blacklist — ADMIN only (403 CONTRACTOR_BLACKLIST_ADMIN_ONLY),
   * otherwise "detach, then accept" would get round the block. An ADMIN's
   * change is logged.
   */
  private async assertContractorChange(
    offer: { id: string; contractorId: string | null },
    companyId: string,
    nextId: string | null,
    actor: { userId: string; role: string } | null,
  ): Promise<void> {
    if (nextId) {
      const next = await this.prisma.contractor.findFirst({ where: { id: nextId, companyId }, select: { id: true } });
      if (!next) {
        const m = msg('OFFER_CONTRACTOR_NOT_FOUND');
        throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
      }
    }
    if (!offer.contractorId) return;
    const previous = await this.prisma.contractor.findFirst({
      where: { id: offer.contractorId, companyId },
      select: { id: true, name: true, isBlacklisted: true },
    });
    if (!previous?.isBlacklisted) return;
    if (actor?.role !== 'ADMIN') {
      const m = msg('CONTRACTOR_BLACKLIST_ADMIN_ONLY');
      throw new ForbiddenException({ statusCode: 403, ...m, message: m.code });
    }
    this.logger.warn(
      `Offer ${offer.id}: blacklisted contractor ${previous.id} (${previous.name}) replaced with ${nextId ?? 'none'} ` +
        `by user ${actor.userId} (ADMIN) at ${new Date().toISOString()}`,
    );
  }

  /**
   * "Przywróć (Nowa)" from EXPIRED or REJECTED only for a live offer: a dead
   * one (`deadReason`, the full rule) would silently go back to EXPIRED on
   * the next run of the expiry task. First change the loading date or
   * `expiresAt` (PATCH /offers/:id), or add a new offer.
   */
  private async assertRestorable(
    offer: { pickupCountry: string; pickupDate: Date; createdAt: Date; expiresAt: Date | null },
    companyId: string,
  ): Promise<void> {
    // The company country — only for a pickup country outside the zone map.
    const companyCountry = countryTimeZone(offer.pickupCountry)
      ? null
      : (await this.prisma.company.findUnique({ where: { id: companyId }, select: { country: true } }))?.country ?? null;
    const reason = deadReason(offer, { now: new Date(), companyCountry });
    if (reason) {
      const m = msg('OFFER_STILL_DEAD', { reason });
      throw new BadRequestException({ statusCode: 400, ...m, message: m.code });
    }
  }

  async delete(id: string, companyId: string) {
    await this.findOne(id, companyId);
    this.invalidateOfferCache(companyId);
    return this.prisma.offer.delete({ where: { id, companyId } });
  }

  /**
   * Search by pickup country and pickup postal code prefix.
   *
   * NOT a radius search: there is no radius parameter.
   */
  async search(companyId: string, filters: { country?: string; postal?: string }) {
    return this.prisma.offer.findMany({
      where: {
        companyId,
        ...(filters.country && { pickupCountry: filters.country }),
        ...(filters.postal && { pickupPostal: { startsWith: filters.postal } }),
      },
      include: {
        contractor: { select: { name: true } },
      },
      orderBy: { pickupDate: 'asc' },
      take: 100,
    });
  }

  /**
   * Offer import: every row is checked on its own (`checkImportRow`) — the
   * valid ones are saved, the bad ones come back in `rejected` as
   * {row, field, code}. Duplicates (the same company, source and `externalId`)
   * are skipped by the database (`skipDuplicates`) and counted in `duplicates`.
   */
  async importOffers(companyId: string, dto: ImportOffersDto): Promise<{ imported: number; duplicates: number; rejected: ImportRejection[] }> {
    const sourceKey = resolveSourceKey(dto.source);
    const rejected: ImportRejection[] = [];
    const now = new Date();

    const rows: unknown[] = dto.offers || [];
    const toCreate: Prisma.OfferCreateManyInput[] = [];
    // The company rate once per batch; new rows have no planner route.
    const rate = await companyRate(this.prisma, companyId);

    for (const [row, input] of rows.entries()) {
      const checked = await checkImportRow(input, row);
      if (checked.ok === false) {
        rejected.push(...checked.rejected);
        continue;
      }
      const { offer: normalized, pricePerKm } = checked;
      toCreate.push({
        companyId,
        source: sourceKey,
        externalId: normalized.externalId || null,
        importedAt: now,
        pickupCity: normalized.pickupCity,
        pickupCountry: normalized.pickupCountry,
        pickupPostal: normalized.pickupPostal || null,
        deliveryCity: normalized.deliveryCity,
        deliveryCountry: normalized.deliveryCountry,
        deliveryPostal: normalized.deliveryPostal || null,
        pickupDate: new Date(normalized.pickupDate),
        deliveryDate: normalized.deliveryDate ? new Date(normalized.deliveryDate) : null,
        cargoType: normalized.cargoType || null,
        // Numeric columns through `??`: 0 is a value from the source, not missing data.
        weightKg: normalized.weightKg ?? null,
        volumeM3: normalized.volumeM3 ?? null,
        price: normalized.price ?? null,
        currency: normalized.currency || 'EUR',
        pricePerKm: pricePerKm ?? null,
        distanceKm: normalized.distanceKm ?? null,
        isAdr: normalized.isAdr || false,
        isFrigo: normalized.isFrigo || false,
        // 0 °C is a real reefer temperature, not missing data — hence `!= null`.
        temperatureMin: normalized.temperatureMin != null ? normalized.temperatureMin : null,
        temperatureMax: normalized.temperatureMax != null ? normalized.temperatureMax : null,
        contactPhone: normalized.contactPhone || null,
        contactEmail: normalized.contactEmail || null,
        clientName: normalized.clientName || null,
        ...economicsWithRate({
          price: normalized.price ?? null,
          currency: normalized.currency || 'EUR',
          distanceKm: normalized.distanceKm ?? null,
          tollCostEstimate: null,
        }, rate),
      });
    }

    if (toCreate.length === 0) {
      return { imported: 0, duplicates: 0, rejected };
    }

    // createMany with skipDuplicates handles the @@unique([companyId, source, externalId]) constraint
    const result = await this.prisma.offer.createMany({
      data: toCreate,
      skipDuplicates: true,
    });

    // Demand matching runs only AFTER the write, and only for rows that actually
    // reached the database.
    //
    // `createMany` returns no rows, and `skipDuplicates` silently skips offers
    // that violate @@unique([companyId, source, externalId]). So the inserted
    // rows are read back by their `importedAt` stamp: every item of this batch
    // got the same `now`, while skipped duplicates kept their earlier stamp — the
    // query hits exactly the inserted rows and carries the `id` the database
    // assigned.
    if (result.count > 0) {
      const inserted = await this.prisma.offer.findMany({
        where: { companyId, source: sourceKey, importedAt: now },
      });

      if (inserted.length !== result.count) {
        this.logger.warn(
          `Import: createMany inserted ${result.count} offers, reading back returned ${inserted.length}. ` +
            `Matching against demands covers ${inserted.length} records.`,
        );
      }

      for (const offer of inserted) {
        this.queueDemandMatching(companyId, offer);
      }
    }

    this.invalidateOfferCache(companyId);

    return {
      imported: result.count,
      duplicates: toCreate.length - result.count,
      rejected,
    };
  }


  async getStats(companyId: string) {
    // Amounts in the company currency through fx (common/money.ts) — not _sum/_avg in the database.
    const money = new MoneyInCompanyCurrency(await companyCurrency(this.prisma, companyId));
    const [total, byStatus, bySource, revenueRows, perKmRows, avgMargin, marginUpperBoundOffers] = await Promise.all([
      this.prisma.offer.count({ where: { companyId } }),
      this.prisma.offer.groupBy({
        by: ['status'],
        where: { companyId },
        _count: true,
      }),
      this.prisma.offer.groupBy({
        by: ['source'],
        where: { companyId },
        _count: true,
      }),
      this.prisma.offer.findMany({
        where: { companyId, status: { in: [...REVENUE_STATUSES] }, price: { not: null } },
        select: { id: true, price: true, currency: true },
      }),
      this.prisma.offer.findMany({
        where: { companyId, pricePerKm: { not: null } },
        select: { id: true, pricePerKm: true, currency: true },
      }),
      // The average from full margins only; upper bounds (no toll) separately — a count.
      this.prisma.offer.aggregate({
        where: { companyId, profitMarginPercent: { not: null }, marginWithoutTolls: false },
        _avg: { profitMarginPercent: true },
      }),
      this.prisma.offer.count({ where: { companyId, profitMarginPercent: { not: null }, marginWithoutTolls: true } }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row.status] = row._count;

    const sourceMap: Record<string, number> = {};
    for (const row of bySource) sourceMap[row.source] = row._count;

    const recentOffers = await this.prisma.offer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        externalId: true,
        status: true,
        source: true,
        pickupCity: true,
        pickupCountry: true,
        deliveryCity: true,
        deliveryCountry: true,
        pickupDate: true,
        price: true,
        currency: true,
        pricePerKm: true,
        profitMarginPercent: true,
        marginWithoutTolls: true,
      },
    });

    return {
      totalOffers: total,
      newOffers: statusMap['NEW'] ?? 0,
      assignedOffers: statusMap['ASSIGNED'] ?? 0,
      acceptedOffers: statusMap['ACCEPTED'] ?? 0,
      rejectedOffers: statusMap['REJECTED'] ?? 0,
      totalRevenue: money.sum(revenueRows.map(r => ({ id: r.id, value: r.price, currency: r.currency }))),
      acceptedCount: revenueRows.length,
      avgPricePerKm: money.average(perKmRows.map(r => ({ id: r.id, value: r.pricePerKm, currency: r.currency }))),
      // Currency of the amounts above, conversion codes, how many amounts without a rate were left out.
      money: money.summary(),
      avgMarginPercent: avgMargin._avg.profitMarginPercent ?? null,
      /** Offers with only an upper-bound margin (no toll) — outside the average. */
      marginUpperBoundOffers,
      bySource: sourceMap,
      recentOffers,
    };
  }

  /**
   * Queues matching of the offer against active demands.
   *
   * The call does not block — a matching failure must not undo saving or
   * importing the offer. It is not swallowed either: it goes to the log with
   * the offer id.
   */
  private queueDemandMatching(companyId: string, offer: Offer): void {
    this.taskQueue
      .enqueue(() => this.demandsService.checkNewOfferAgainstDemands(companyId, offer))
      .catch((err: unknown) => {
        this.logger.error(
          `Matching offer ${offer?.id ?? '(no id)'} against demands failed: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
  }

  private invalidateOfferCache(companyId: string): void {
    this.cache.deleteByPrefix(`offers:${companyId}`);
  }
}

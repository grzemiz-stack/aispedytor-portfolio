import { TRUSTED_ROUTE } from '../common/route-trust';
import { Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LtlSearchDto } from './dto/ltl-search.dto';
import { CreateLoadPlanDto } from './dto/load-plan.dto';
import { msg, dedupeMessages, type PlanMessage } from '../common/plan-messages';
import { GeocodingService } from '../geocoding/geocoding.service';
import {
  MAX_OFFER_AGE_DAYS,
  checkCompatibility,
  isDeadOffer,
  pickupDateLowerBound,
  type CompatVehicle,
} from './offer-compatibility';
import { compareByValue, offerValue, roundedValue, type OfferValue } from './offer-value';
import { combinationAxleClass, type AxleCombination } from '../common/axle-class';
import { counterpartyRisk } from '../common/counterparty-risk';
import { TOLL_PROVIDER, type TollProvider } from '../tolls/toll-provider';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Detour limit when the request has none — the same value as the screen slider's default. */
export const DEFAULT_MAX_DETOUR_KM = 100;

/** How many offers with an amount (profit/revenue) the result returns. */
const MAX_VALUED_MATCHES = 20;
/** How many offers without an amount (no price / no rate) are returned at the end; the rest → `hiddenWithoutAmount`. */
const MAX_UNVALUED_MATCHES = 10;
/** How many offers without coordinates are returned in `awaitingLocation`; the rest → `hiddenAwaitingLocation`. */
const MAX_AWAITING_LOCATION = 10;
/** How many offers from a blacklisted contractor come back at the end of `matches`; the rest → `hiddenBlocked`. */
const MAX_BLOCKED_MATCHES = 10;
/** How many offers without weight/dimensions come back in `unmeasurable`; the full number in `unmeasurableTotal`. */
const MAX_UNMEASURABLE = 20;

const EUROPALLET_LENGTH_M = 0.4; // 1 euro pallet on a semi-trailer = 0.4 loading metres
const EARTH_RADIUS_KM = 6371;

/**
 * Straight line → road distance factor. An approximation only — the search
 * result says so once (`DETOUR_APPROXIMATE` in `notices`). Negotiation and
 * hub distances use their own factor (1.3); see docs/known-issues.md
 * ("three road factors").
 */
export const ROAD_FACTOR = 1.25;

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface VehicleCapacity {
  vehicleId: string;
  plateNumber: string;
  vehicleType: string;
  trailerType: string | null;
  maxLoadingMeters: number;
  maxWeightKg: number;
  maxPalletCount: number;
  currentLoadMeters: number;
  currentLoadWeightKg: number;
  freeMeters: number;
  freeWeightKg: number;
  freePallets: number;
  utilizationMetersPercent: number;
  utilizationWeightPercent: number;
}

export interface LoadPlanPosition {
  position: number;
  offerId: string;
  description: string;
  loadingCity: string;
  unloadingCity: string;
  weightKg: number;
  meters: number;
  startM: number;
  endM: number;
  cogFromRear: number;
  cumulativeWeightKg: number;
  cumulativeMeters: number;
  warnings: PlanMessage[];
}

export interface LoadPlanResult {
  vehicleId: string;
  maxMeters: number;
  maxWeightKg: number;
  /** Gross vehicle weight of the combination, from the vehicle record. */
  grossVehicleWeightKg: number;
  /** Curb weight of the combination, from the vehicle record. */
  curbWeightKg: number;
  /** Curb weight + total cargo weight. */
  totalGrossWeightKg: number;
  totalWeightKg: number;
  totalMeters: number;
  freeMeters: number;
  freeWeightKg: number;
  positions: LoadPlanPosition[];
  isValid: boolean;
  warnings: PlanMessage[];
}

export interface LtlMatch {
  offerId: string;
  /**
   * How well the load fits the vehicle, 0–100: metres, weight, detour, contractor.
   * Information only — the order is decided by `value.amount`.
   */
  fitScore: number;
  externalId: string | null;
  source: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: Date;
  cargoType: string | null;
  weightKg: number | null;
  lengthM: number | null;
  palletCount: number | null;
  price: number | null;
  currency: string;
  pricePerKm: number | null;
  contractorName: string | null;
  contractorReliability: number | null;
  detourKm: number;
  detourPercent: number;
  metersNeeded: number;
  /**
   * Warnings about THIS offer.
   * Information about the whole result is in `notices`, not here.
   */
  warnings: PlanMessage[];
  scoring: {
    metersUtilization: number;
    weightUtilization: number;
    detourEfficiency: number;
    contractorScore: number;
  };
  /** Profit or revenue in the company's currency — the ranking key (offer-value.ts). */
  value: OfferValue;
  /**
   * `COUNTERPARTY_RISK {criteria}` (common/counterparty-risk.ts) or `null`.
   * Shown next to the amount; does not change the order.
   */
  counterpartyRisk: PlanMessage | null;
  /**
   * The acceptance block: OFFER_CONTRACTOR_BLACKLISTED for a contractor on
   * this company's blacklist — as `blockedBy` in matching. An empty list = no
   * block. A blocked offer goes to the end of the list.
   */
  blockedBy: PlanMessage[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

/** Data without which the vehicle's load cannot be computed. */
export type MissingLoadData = 'weightKg' | 'dimensions';

/**
 * An offer that cannot be checked against capacity — with the route, the
 * loading date and what is missing (the screen shows it with a link to fill
 * the data in).
 */
export interface UnmeasurableOffer {
  offerId: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: Date;
  missing: MissingLoadData[];
}

/**
 * A live offer that is incompatible with THIS vehicle — with all reasons.
 * Shown below the list, collapsed (docs/decisions.md §6).
 */
export interface IncompatibleOffer {
  offerId: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: Date;
  reasons: PlanMessage[];
}

/**
 * An offer's weight and length in a form the capacity check can use.
 * A non-empty `missing` means "cannot be computed" — then `weightKg` and
 * `metersNeeded` are `null` and must NOT be replaced by zero or a default.
 */
interface OfferLoadFootprint {
  missing: MissingLoadData[];
  weightKg: number | null;
  metersNeeded: number | null;
}

/**
 * An offer without pickup or delivery coordinates — its detour cannot be
 * computed, so it is not ranked (docs/decisions.md §2). It waits until the
 * background geocoding task places it. Same shape as `IncompatibleOffer`; the
 * reason is always `OFFER_AWAITING_LOCATION`.
 */
export type AwaitingLocationOffer = IncompatibleOffer;

/** A vehicle record field without which capacity cannot be computed. */
export type MissingVehicleData =
  | 'maxWeightKg'
  | 'maxLoadingMeters'
  | 'grossVehicleWeightKg'
  | 'curbWeightKg';

/**
 * The vehicle record is incomplete — the capacity calculation is blocked.
 *
 * A missing gross weight is not a reason to guess: any substituted number either
 * overstates or understates the allowed extra load, and the operator cannot tell
 * a recorded value from an invented one. Instead, an explicit state names the
 * missing field.
 */
export class IncompleteVehicleRecordException extends UnprocessableEntityException {
  constructor(vehicleId: string, plateNumber: string, missing: MissingVehicleData[]) {
    super({
      statusCode: 422,
      error: 'IncompleteVehicleRecord',
      message:
        `Kartoteka pojazdu ${plateNumber} jest niekompletna — nie da się policzyć ładowności. ` +
        `Brakuje: ${missing.join(', ')}.`,
      vehicleId,
      plateNumber,
      missing,
    });
  }
}

/** Counterparty risk criteria as one code on the card; `null` = no signal. */
// BLACKLIST is not part of it — `blockedBy` carries the blacklist.
function riskMessage(contractor: Parameters<typeof counterpartyRisk>[0]): PlanMessage | null {
  const criteria = counterpartyRisk(contractor).filter((c) => c !== 'BLACKLIST');
  return criteria.length > 0 ? msg('COUNTERPARTY_RISK', { criteria: criteria.join(',') }) : null;
}

@Injectable()
export class LtlMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    /** Only whether one is registered matters here: LTL reads toll from route_calculations. */
    @Optional() @Inject(TOLL_PROVIDER) private readonly tollProvider: TollProvider | null = null,
  ) {}

  /** The clock as a field — tests set "now" instead of waiting for midnight. */
  now: () => Date = () => new Date();

  /**
   * Stops the calculation when the vehicle record lacks data needed for
   * capacity. To extend: add the field here and in `MissingVehicleData`.
   */
  private assertVehicleRecordComplete(vehicle: {
    id: string;
    plateNumber: string;
    maxWeightKg?: number | null;
    maxLoadingMeters?: number | null;
    grossVehicleWeightKg?: number | null;
    curbWeightKg?: number | null;
  }): void {
    const missing: MissingVehicleData[] = [];
    if (vehicle.maxWeightKg == null) missing.push('maxWeightKg');
    if (vehicle.maxLoadingMeters == null) missing.push('maxLoadingMeters');
    // `== null`, not a truthiness test: a curb weight of 0 is a value.
    if (vehicle.grossVehicleWeightKg == null) missing.push('grossVehicleWeightKg');
    if (vehicle.curbWeightKg == null) missing.push('curbWeightKg');

    if (missing.length > 0) {
      throw new IncompleteVehicleRecordException(vehicle.id, vehicle.plateNumber, missing);
    }
  }

  // ─── Vehicle capacity ────────────────────────────────────────────────────

  async getVehicleCapacity(
    vehicleId: string,
    companyId: string,
    currentLoadMeters: number,
    currentLoadWeightKg: number,
  ): Promise<VehicleCapacity> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    this.assertVehicleRecordComplete(vehicle);

    const maxMeters = vehicle.maxLoadingMeters;
    const maxWeightKg = vehicle.maxWeightKg;
    const maxPallets = vehicle.maxPalletCount || Math.floor(maxMeters / EUROPALLET_LENGTH_M);

    const freeMeters = Math.max(0, maxMeters - currentLoadMeters);
    const freeWeightKg = Math.max(0, maxWeightKg - currentLoadWeightKg);
    const freePallets = Math.floor(freeMeters / EUROPALLET_LENGTH_M);

    const utilizationMeters = maxMeters > 0 ? (currentLoadMeters / maxMeters) * 100 : 0;
    const utilizationWeight = maxWeightKg > 0 ? (currentLoadWeightKg / maxWeightKg) * 100 : 0;

    return {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      trailerType: vehicle.trailerType,
      maxLoadingMeters: maxMeters,
      maxWeightKg,
      maxPalletCount: maxPallets,
      currentLoadMeters,
      currentLoadWeightKg: currentLoadWeightKg,
      freeMeters: this.round(freeMeters, 1),
      freeWeightKg: Math.round(freeWeightKg),
      freePallets,
      utilizationMetersPercent: this.round(utilizationMeters, 1),
      utilizationWeightPercent: this.round(utilizationWeight, 1),
    };
  }

  /**
   * Determines an offer's weight and length for the capacity check.
   *
   * Missing data must NOT pass as zero: `weightKg = null` means "weight
   * unknown", not "weighs nothing". Defaults such as `weightKg || 0` or
   * `lengthM || 2.4` would let an offer without weight pass the check as
   * weightless, and give an offer without dimensions an invented 2.4 m.
   *
   * Zero stays a meaningful value — `weightKg = 0` can be computed.
   */
  private resolveLoadFootprint(offer: {
    weightKg?: number | null;
    lengthM?: number | null;
    palletCount?: number | null;
  }): OfferLoadFootprint {
    const missing: MissingLoadData[] = [];

    const weightKg = offer.weightKg != null ? Number(offer.weightKg) : null;
    if (weightKg === null) missing.push('weightKg');

    // Length as given; without it — derived from the pallet count.
    let metersNeeded: number | null = null;
    if (offer.lengthM != null) {
      metersNeeded = Number(offer.lengthM);
    } else if (offer.palletCount != null) {
      metersNeeded = Number(offer.palletCount) * EUROPALLET_LENGTH_M;
    }
    if (metersNeeded === null) missing.push('dimensions');

    return { missing, weightKg, metersNeeded };
  }

  // ─── Find matching offers ────────────────────────────────────────────────

  async findMatchingOffers(
    companyId: string,
    dto: LtlSearchDto,
  ): Promise<{
    capacity: VehicleCapacity;
    matches: LtlMatch[];
    /** At most MAX_UNMEASURABLE, the nearest loading first, then id. */
    unmeasurable: UnmeasurableOffer[];
    /** Every offer without weight/dimensions — the screen section's header. */
    unmeasurableTotal: number;
    /** Offers incompatible with the vehicle, with reasons. */
    incompatible: IncompatibleOffer[];
    /** Information about the whole result, shown once above the list (info level). */
    notices: PlanMessage[];
    /** Offers without an amount beyond MAX_UNVALUED_MATCHES — the front end shows "+N hidden". */
    hiddenWithoutAmount: number;
    /** Oferty z czarnej listy ponad MAX_BLOCKED_MATCHES — front pokazuje „+N”. */
    hiddenBlocked: number;
    /**
     * Offers without coordinates — outside the ranking, with OFFER_AWAITING_LOCATION.
     * Earliest pickup first, then id; at most MAX_AWAITING_LOCATION.
     */
    awaitingLocation: AwaitingLocationOffer[];
    /** Offers without coordinates beyond the limit — the front end shows "+N hidden". */
    hiddenAwaitingLocation: number;
  }> {
    // One detour limit — the one from the screen slider (km). No hidden second
    // limit (such as a share of the route): the user could neither see nor set
    // it, and on short routes it would empty the result without a reason.
    const maxDetourKm = dto.maxDetourKm ?? DEFAULT_MAX_DETOUR_KM;

    // Get vehicle capacity
    const capacity = await this.getVehicleCapacity(
      dto.vehicleId,
      companyId,
      dto.currentLoadMeters,
      dto.currentLoadWeight * 1000, // t → kg
    );

    // Geocode route endpoints
    const [fromCoords, toCoords] = await Promise.all([
      this.geocode(dto.routeFrom),
      this.geocode(dto.routeTo),
    ]);

    // Without both route ends there is nothing to compute — but that is not
    // "no offers": an empty list would look exactly like no matches.
    if (!fromCoords || !toCoords) {
      const places = [!fromCoords && dto.routeFrom, !toCoords && dto.routeTo].filter(Boolean).join(' · ');
      const m = msg('ROUTE_GEOCODING_FAILED', { places });
      throw new UnprocessableEntityException({ statusCode: 422, ...m, message: m.code });
    }

    const routeDistKm = this.roadKm(fromCoords, toCoords);

    const effectiveMaxDetour = maxDetourKm;

    const now = this.now();
    const compatVehicle = await this.loadCompatVehicle(dto.vehicleId, companyId);

    // Layer 1, in the query: dead offers drop out before the 200 limit is
    // applied — otherwise they would take the place of live ones. The pickup
    // date has a margin (the query does not know the offer's time zone); the
    // exact test is isDeadOffer.
    const offers = await this.prisma.offer.findMany({
      where: {
        companyId,
        status: 'NEW',
        pickupDate: { gte: pickupDateLowerBound(now) },
        createdAt: { gte: new Date(now.getTime() - MAX_OFFER_AGE_DAYS * 24 * 60 * 60 * 1000) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        contractor: {
          select: { id: true, companyId: true, name: true, reliabilityScore: true, paymentRating: true, isBlacklisted: true },
        },
        // The offer route's toll, for the detour toll. offer-value.ts picks the row.
        // Without suspected fallback routes (common/route-trust.ts).
        routeCalculations: {
          where: TRUSTED_ROUTE,
          select: {
            distanceKm: true,
            tollTotalEur: true,
            axleClass: true,
            axleClassDefaulted: true,
            tollNeedsVerification: true,
            calculatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Company: cost per km and currency for the offer value; country — the
    // fallback time zone when the pickup country is not on the map.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { country: true, costPerKm: true, costCurrency: true },
    });
    const companyCost = {
      costPerKm: company?.costPerKm != null ? Number(company.costPerKm) : null,
      costCurrency: company?.costCurrency ?? 'PLN',
    };
    const ctx = { now, companyCountry: company?.country ?? null };
    const axle = combinationAxleClass(compatVehicle);
    const vehicleAxleClass = axle.axleClass;

    // Filter and score
    const matches: LtlMatch[] = [];
    /** Exact values for sorting — `LtlMatch.value` and `detourKm` are rounded. */
    const exactValue = new Map<string, OfferValue>();
    const unmeasurable: UnmeasurableOffer[] = [];
    const incompatible: IncompatibleOffer[] = [];
    const awaitingLocation: AwaitingLocationOffer[] = [];

    for (const offer of offers) {
      // Exact dead-offer test — in the pickup country's time zone.
      if (isDeadOffer(offer, ctx)) continue;

      // Incompatible with the vehicle: not scored, but listed with the reasons.
      const compat = checkCompatibility(offer, compatVehicle, ctx);
      if (compat.reasons.length > 0) {
        incompatible.push({
          offerId: offer.id,
          pickupCity: offer.pickupCity,
          pickupCountry: offer.pickupCountry,
          deliveryCity: offer.deliveryCity,
          deliveryCountry: offer.deliveryCountry,
          pickupDate: offer.pickupDate,
          reasons: compat.reasons,
        });
        continue;
      }

      // Missing weight or dimensions exclude the offer from the capacity
      // calculation — it is not matched, but it is reported explicitly so the
      // dispatcher knows it exists and what it lacks.
      const footprint = this.resolveLoadFootprint(offer);
      if (footprint.missing.length > 0) {
        unmeasurable.push({
          offerId: offer.id,
          pickupCity: offer.pickupCity,
          pickupCountry: offer.pickupCountry,
          deliveryCity: offer.deliveryCity,
          deliveryCountry: offer.deliveryCountry,
          pickupDate: offer.pickupDate,
          missing: footprint.missing,
        });
        continue;
      }
      const weightKg = footprint.weightKg as number;
      const metersNeeded = footprint.metersNeeded as number;

      // Weight and space check
      if (weightKg > capacity.freeWeightKg) continue;
      if (metersNeeded > capacity.freeMeters) continue;

      // Without coordinates there is no detour — and it is not guessed. A
      // guessed detour per pickup country would rank offers from the far end
      // of the country (Warsaw → Berlin on a Poznań → Berlin route) first.
      // `!= null`, not a truthiness test: a coordinate of 0 is a coordinate.
      if (
        offer.pickupLat == null || offer.pickupLng == null ||
        offer.deliveryLat == null || offer.deliveryLng == null
      ) {
        awaitingLocation.push({
          offerId: offer.id,
          pickupCity: offer.pickupCity,
          pickupCountry: offer.pickupCountry,
          deliveryCity: offer.deliveryCity,
          deliveryCountry: offer.deliveryCountry,
          pickupDate: offer.pickupDate,
          reasons: [msg('OFFER_AWAITING_LOCATION')],
        });
        continue;
      }

      const warnings: PlanMessage[] = [...compat.warnings];
      const pickup = { lat: offer.pickupLat, lng: offer.pickupLng };
      const delivery = { lat: offer.deliveryLat, lng: offer.deliveryLng };
      // Trip with the extra load: from → pickup → delivery → to, minus the trip
      // without it. A shortcut like min(delivery→to, delivery→from) would make
      // a return to base (delivery = from) look free.
      const detourKm =
        this.roadKm(fromCoords, pickup) +
        this.roadKm(pickup, delivery) +
        this.roadKm(delivery, toCoords) -
        routeDistKm;

      if (detourKm > effectiveMaxDetour) continue;

      const detourPercent = routeDistKm > 0 ? (detourKm / routeDistKm) * 100 : 0;
      // `!= null`: a price of 0 is a price; no price is missing (OFFER_PRICE_MISSING).
      const price = offer.price != null ? Number(offer.price) : null;

      // Scoring (0-100)
      const metersScore = capacity.freeMeters > 0
        ? (metersNeeded / capacity.freeMeters) * 30
        : 0;
      const weightScore = capacity.freeWeightKg > 0
        ? (weightKg / capacity.freeWeightKg) * 25
        : 0;
      const detourScore = effectiveMaxDetour > 0
        ? (1 - detourKm / effectiveMaxDetour) * 20
        : 0;
      // A rating of 0 is the worst rating in the 0-100 range, so 0 points. Only
      // a MISSING rating scores neutral (5). A truthiness test would treat the
      // two alike and rank the worst contractor above an average one.
      const contractorScore = offer.contractor?.reliabilityScore != null
        ? (offer.contractor.reliabilityScore / 100) * 10
        : 5;

      // Fit without revenue, rescaled from 85 points to 0–100. Money is in
      // `value`, not here.
      const fitScore = Math.round(
        Math.max(0, Math.min(100, ((metersScore + weightScore + detourScore + contractorScore) / 85) * 100)),
      );

      const value = offerValue({
        price,
        priceCurrency: offer.currency,
        detourKm,
        company: companyCost,
        vehicleAxleClass,
        routeCalculations: (offer.routeCalculations ?? []).map(r => ({ ...r, tollTotalEur: Number(r.tollTotalEur) })),
        tollProviderConfigured: this.tollProvider !== null,
      });
      exactValue.set(offer.id, value);

      matches.push({
        offerId: offer.id,
        fitScore,
        externalId: offer.externalId,
        source: offer.source,
        pickupCity: offer.pickupCity,
        pickupCountry: offer.pickupCountry,
        deliveryCity: offer.deliveryCity,
        deliveryCountry: offer.deliveryCountry,
        pickupDate: offer.pickupDate,
        cargoType: offer.cargoType,
        weightKg: offer.weightKg,
        lengthM: offer.lengthM,
        palletCount: offer.palletCount,
        price,
        currency: offer.currency,
        pricePerKm: offer.pricePerKm != null ? Number(offer.pricePerKm) : null,
        contractorName: offer.contractor?.name || offer.clientName || null,
        // reliabilityScore is 0-100: zero is the worst rating, not a missing one.
        contractorReliability: offer.contractor?.reliabilityScore ?? null,
        detourKm: this.round(detourKm, 0),
        detourPercent: this.round(detourPercent, 1),
        metersNeeded: this.round(metersNeeded, 1),
        warnings,
        scoring: {
          metersUtilization: this.round(metersScore, 1),
          weightUtilization: this.round(weightScore, 1),
          detourEfficiency: this.round(detourScore, 1),
          contractorScore: this.round(contractorScore, 1),
        },
        value: roundedValue(value),
        counterpartyRisk: riskMessage(offer.contractor),
        // A contractor of another company does not count (the relation has no company check).
        blockedBy: offer.contractor?.isBlacklisted === true && offer.contractor.companyId === companyId
          ? [msg('OFFER_CONTRACTOR_BLACKLISTED')]
          : [],
      });
    }

    // Ranking by the exact amount (offer-value.ts: compareByValue). Offers
    // without an amount (no price / no rate) go last, with their own limit —
    // they do not push out offers with an amount; `hiddenWithoutAmount` says
    // how many were hidden.
    const byValue = (a: LtlMatch, b: LtlMatch) =>
      compareByValue(
        { offerId: a.offerId, value: exactValue.get(a.offerId)! },
        { offerId: b.offerId, value: exactValue.get(b.offerId)! },
      );
    matches.sort(byValue);
    // The blacklist: outside the ranking, at the very end, its own limit.
    const open = matches.filter(m => m.blockedBy.length === 0);
    const allBlocked = matches.filter(m => m.blockedBy.length > 0);
    const blocked = allBlocked.slice(0, MAX_BLOCKED_MATCHES);
    const hiddenBlocked = allBlocked.length - blocked.length;
    const valued = open.filter(m => m.value.amount != null).slice(0, MAX_VALUED_MATCHES);
    const allUnvalued = open.filter(m => m.value.amount == null);
    const unvalued = allUnvalued.slice(0, MAX_UNVALUED_MATCHES);
    const hiddenWithoutAmount = allUnvalued.length - unvalued.length;

    // The whole result is computed from straight line × factor (the route
    // distance too), so this is information about the result, not one offer.
    const notices = [msg('DETOUR_APPROXIMATE', { roadFactor: ROAD_FACTOR })];
    // Once above the list: without a provider no detour toll is counted (each card has the code too).
    if (this.tollProvider === null) notices.push(msg('TOLL_PROVIDER_NOT_CONFIGURED'));

    // The list without coordinates is not a ranking — only that they wait.
    // Not filtered by country (docs/known-issues.md), so it can be long:
    // a limit plus a count.
    awaitingLocation.sort((a, b) =>
      (a.pickupDate?.getTime?.() ?? Infinity) - (b.pickupDate?.getTime?.() ?? Infinity) ||
      (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0));
    const hiddenAwaitingLocation = Math.max(0, awaitingLocation.length - MAX_AWAITING_LOCATION);
    // Without weight/dimensions: the same order; the screen shows 20 and "and N more".
    unmeasurable.sort((a, b) =>
      (a.pickupDate?.getTime?.() ?? Infinity) - (b.pickupDate?.getTime?.() ?? Infinity) ||
      (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0));

    return {
      capacity,
      matches: [...valued, ...unvalued, ...blocked],
      unmeasurable: unmeasurable.slice(0, MAX_UNMEASURABLE),
      unmeasurableTotal: unmeasurable.length,
      incompatible,
      notices,
      hiddenWithoutAmount,
      hiddenBlocked,
      awaitingLocation: awaitingLocation.slice(0, MAX_AWAITING_LOCATION),
      hiddenAwaitingLocation,
    };
  }

  // ─── Load plan calculation ─────────────────────────────────────────────

  async calculateLoadPlan(
    companyId: string,
    dto: CreateLoadPlanDto,
  ): Promise<LoadPlanResult> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, companyId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    this.assertVehicleRecordComplete(vehicle);

    const maxMeters = vehicle.maxLoadingMeters;
    const maxWeightKg = vehicle.maxWeightKg;
    const grossVehicleWeightKg = vehicle.grossVehicleWeightKg;
    const curbWeightKg = vehicle.curbWeightKg;

    // Sort loads by position (if provided) or keep order as-is
    const sortedLoads = [...dto.loads].sort((a, b) => {
      const posA = a.position ?? Infinity;
      const posB = b.position ?? Infinity;
      return posA - posB;
    });

    const positions: LoadPlanPosition[] = [];
    let cumulativeWeightKg = 0;
    let cumulativeMeters = 0;
    const allWarnings: PlanMessage[] = [];

    for (let i = 0; i < sortedLoads.length; i++) {
      const load = sortedLoads[i];
      const startM = cumulativeMeters;
      const endM = startM + load.meters;
      const cogFromRear = startM + load.meters / 2;

      cumulativeWeightKg += load.weight;
      cumulativeMeters += load.meters;

      const posWarnings: PlanMessage[] = [];
      if (cumulativeMeters > maxMeters) {
        posWarnings.push(msg('LOAD_PLAN_LENGTH_EXCEEDED', {
          usedM: this.round(cumulativeMeters, 1),
          maxM: maxMeters,
        }));
      }
      if (cumulativeWeightKg > maxWeightKg) {
        posWarnings.push(msg('LOAD_PLAN_WEIGHT_EXCEEDED', {
          usedKg: Math.round(cumulativeWeightKg),
          maxKg: Math.round(maxWeightKg),
        }));
      }
      // Gross combination weight check. It answers a different question than
      // capacity: the one above is how much may be loaded, this one is how much
      // the combination may weigh with its curb weight.
      const grossWeightKg = curbWeightKg + cumulativeWeightKg;
      if (grossWeightKg > grossVehicleWeightKg) {
        posWarnings.push(msg('GVW_EXCEEDED', {
          grossKg: Math.round(grossWeightKg),
          maxGvwKg: Math.round(grossVehicleWeightKg),
          curbKg: Math.round(curbWeightKg),
          cargoKg: Math.round(cumulativeWeightKg),
        }));
      }
      allWarnings.push(...posWarnings);

      positions.push({
        position: i + 1,
        offerId: load.offerId,
        description: load.description || `${load.loadingCity} → ${load.unloadingCity}`,
        loadingCity: load.loadingCity,
        unloadingCity: load.unloadingCity,
        weightKg: load.weight,
        meters: load.meters,
        startM: this.round(startM, 2),
        endM: this.round(endM, 2),
        cogFromRear: this.round(cogFromRear, 2),
        cumulativeWeightKg,
        cumulativeMeters: this.round(cumulativeMeters, 1),
        warnings: posWarnings,
      });
    }

    const uniqueWarnings = dedupeMessages(allWarnings);

    return {
      vehicleId: dto.vehicleId,
      maxMeters,
      maxWeightKg,
      grossVehicleWeightKg,
      curbWeightKg,
      totalGrossWeightKg: curbWeightKg + cumulativeWeightKg,
      totalWeightKg: cumulativeWeightKg,
      totalMeters: this.round(cumulativeMeters, 1),
      freeMeters: this.round(Math.max(0, maxMeters - cumulativeMeters), 1),
      freeWeightKg: Math.max(0, maxWeightKg - cumulativeWeightKg),
      positions,
      isValid: uniqueWarnings.length === 0,
      warnings: uniqueWarnings,
    };
  }

  async optimizeLoadPlan(
    companyId: string,
    dto: CreateLoadPlanDto,
  ): Promise<LoadPlanResult> {
    // Sequencing strategy: heaviest loads closer to the middle of the cargo
    // space, lighter ones at the ends. A loading-order heuristic — it neither
    // computes nor claims axle loads.
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, companyId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    this.assertVehicleRecordComplete(vehicle);

    // Order: heaviest first, alternately at the rear and at the front — the
    // heaviest end up in the middle. Order only; axle loads are not computed (README).
    const sortedByWeight = [...dto.loads].sort((a, b) => b.weight - a.weight);
    const placed: boolean[] = new Array(sortedByWeight.length).fill(false);
    const orderedLoads: typeof dto.loads = [];
    let placeFromRear = true;

    for (let round = 0; round < sortedByWeight.length; round++) {
      // Find heaviest unplaced load
      let bestIdx = -1;
      for (let i = 0; i < sortedByWeight.length; i++) {
        if (!placed[i]) { bestIdx = i; break; }
      }
      if (bestIdx === -1) break;

      placed[bestIdx] = true;
      if (placeFromRear) {
        // Place near rear (doors) — position 1
        orderedLoads.push(sortedByWeight[bestIdx]);
      } else {
        // Place near front
        orderedLoads.unshift(sortedByWeight[bestIdx]);
      }
      placeFromRear = !placeFromRear;
    }

    // Position 1 = nearest the doors (rear).
    const optimizedDto: CreateLoadPlanDto = {
      vehicleId: dto.vehicleId,
      loads: orderedLoads.map((l, i) => ({ ...l, position: i + 1 })),
    };

    return this.calculateLoadPlan(companyId, optimizedDto);
  }

  // ─── Geocoding (Nominatim) ───────────────────────────────────────────────

  /**
   * The vehicle with the fields compatibility needs — together with trailers
   * stored as separate records (`parentVehicleId`), since the reefer is often
   * the semi-trailer.
   */
  private async loadCompatVehicle(
    vehicleId: string,
    companyId: string,
  ): Promise<CompatVehicle & AxleCombination & { grossVehicleWeightKg?: number | null }> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId },
      select: {
        hasAdr: true,
        adrClasses: true,
        vehicleType: true,
        trailerType: true,
        availableFrom: true,
        // Category and axles — the combination's axle class for the detour toll.
        vehicleCategory: true,
        axleCount: true,
        grossVehicleWeightKg: true,
        trailers: { select: { vehicleType: true, trailerType: true, vehicleCategory: true, axleCount: true } },
      },
    });
    // getVehicleCapacity has already checked that the vehicle exists.
    return vehicle ?? {};
  }

  /** Through the shared service: its cache and 1 request/s limit apply here too. */
  private geocode(query: string): Promise<{ lat: number; lng: number } | null> {
    return this.geocoding.geocode(query);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Approximate road distance: straight line × ROAD_FACTOR. */
  private roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return this.haversineKm(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR;
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private round(n: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
  }
}

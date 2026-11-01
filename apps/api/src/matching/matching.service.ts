import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OfferStatus, type Offer, type Prisma } from '@prisma/client';
import { isReefer, requiresReefer } from '../common/reefer';
import { adrCompatibility } from '../common/adr';
import { msg, type PlanMessage } from '../common/plan-messages';
import { countryTimeZone, dateOnlyDay, pickupDay } from '../common/country-timezone';
import { deadReason, MAX_OFFER_AGE_DAYS, pickupDateLowerBound, type DeadReason } from '../ltl-matching/offer-compatibility';

/** Trailers stored as separate vehicle records — often the trailer is what makes a reefer. */
const TRAILER_TYPES = { trailers: { select: { vehicleType: true, trailerType: true } } } as const;
/** A vehicle as this service loads it: with the types of its attached trailers. */
type MatchVehicle = Prisma.VehicleGetPayload<{ include: typeof TRAILER_TYPES }>;

export interface MatchDetails {
  typeMatch: number;      // 0-30
  available: number;      // 0-25
  capacityOk: number;     // 0-20
  locationMatch: number;  // 0-15
  docsValid: number;      // 0-10
}

/**
 * ADR (common/adr.ts — the same rule as LTL). A vehicle that may not carry the
 * load stays in the list with score 0 and the reason — it does not silently disappear.
 */
interface AdrResult {
  /** Why the vehicle may not carry the load (e.g. OFFER_ADR_VEHICLE_NOT_CERTIFIED); empty list = compatible. */
  blockedBy: PlanMessage[];
  /** Notes that do not block (e.g. OFFER_ADR_CLASS_NOT_GIVEN). */
  warnings: PlanMessage[];
}

export interface VehicleMatch extends AdrResult {
  vehicleId: string;
  vehicleName: string;
  licensePlate: string;
  matchScore: number;
  matchDetails: MatchDetails;
  recommendation: string;
}

export interface OfferMatch extends AdrResult {
  offerId: string;
  route: string;
  price: number | null;
  currency: string;
  matchScore: number;
  matchDetails: MatchDetails;
  recommendation: string;
}

/** How many candidate offers the list query reads (as the LTL limit) before dead ones drop out. */
const CANDIDATE_LIMIT = 200;
/** The age threshold of a NEW offer — the same as LTL and the expiry task (7 days). */
const MAX_AGE_MS = MAX_OFFER_AGE_DAYS * 86_400_000;

const BLOCKED_RECOMMENDATION = 'Niezgodny — pojazd nie może wieźć tego ładunku.';

/**
 * The loading day in the pickup country's time zone, as in LTL (before: the
 * UTC day). An offer without a date — today in that zone.
 */
const loadingDayOf = (offer: Offer, companyCountry: string | null) =>
  pickupDay(offer.pickupDate, offer.pickupCountry, companyCountry);

/** Document expiry dates in the order of `DOCUMENT_FIELDS`. */
const DOCUMENT_FIELDS = ['technicalInspectionTo', 'insuranceTo', 'tachographLegalizationTo'] as const;
const documentDates = (vehicle: MatchVehicle) => DOCUMENT_FIELDS.map((f) => vehicle[f]);

/**
 * Fields without which a score component cannot be computed: the offer
 * weight, the vehicle payload, the vehicle country, the document dates (the
 * offer's pickup country is required in the database). A fixed order — that
 * is how they go into `MATCH_DATA_UNKNOWN.params.fields`.
 */
function unknownFields(vehicle: MatchVehicle, offer: Offer): string[] {
  const out: string[] = [];
  if (offer.weightKg === null) out.push('weightKg');
  if (!vehicle.maxWeightKg) out.push('maxWeightKg');
  if (!vehicle.currentCountry) out.push('currentCountry');
  for (const f of DOCUMENT_FIELDS) if (!vehicle[f]) out.push(f);
  return out;
}

export interface MatchSuggestion {
  offer: { id: string; route: string; price: number | null; currency: string };
  vehicle: { id: string; name: string; licensePlate: string };
  matchScore: number;
  recommendation: string;
}

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Public methods ────────────────────────────────────────────────────────

  async findMatchingVehicles(offerId: string, companyId: string): Promise<VehicleMatch[]> {
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, companyId } });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');

    const vehicles = await this.prisma.vehicle.findMany({ where: { companyId }, include: TRAILER_TYPES });
    const companyCountry = await this.companyCountryFor(companyId, [offer]);
    // A dead offer opened directly (the offer page): scored as usual, but said
    // with a code. ACCEPTED and later — an order in progress, no code.
    const notLive = this.notLiveReason(offer, companyCountry);
    const notLiveWarning = notLive ? [msg('MATCH_OFFER_NOT_LIVE', { reason: notLive })] : [];

    return vehicles
      .map((v) => this.scoreVehicleForOffer(v, offer, companyCountry))
      .map((m) => (notLiveWarning.length ? { ...m, warnings: [...m.warnings, ...notLiveWarning] } : m))
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  async findMatchingOffers(vehicleId: string, companyId: string): Promise<OfferMatch[]> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId }, include: TRAILER_TYPES });
    if (!vehicle) throw new NotFoundException('Pojazd nie znaleziony');

    const { offers, companyCountry } = await this.liveOffers(companyId, 50);

    return offers
      .map((o) => this.scoreOfferForVehicle(o, vehicle, companyCountry))
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  async getSuggestions(companyId: string): Promise<MatchSuggestion[]> {
    const [{ offers, companyCountry }, vehicles] = await Promise.all([
      this.liveOffers(companyId, 20),
      this.prisma.vehicle.findMany({ where: { companyId }, include: TRAILER_TYPES }),
    ]);

    if (!vehicles.length || !offers.length) return [];

    const suggestions: MatchSuggestion[] = [];

    for (const offer of offers) {
      let best: VehicleMatch | null = null;
      for (const v of vehicles) {
        const m = this.scoreVehicleForOffer(v, offer, companyCountry);
        // An ADR-incompatible vehicle scores 0 and cannot reach the threshold of 30 below,
        // so a suggestion only ever comes from a vehicle that may carry the load.
        if (!best || m.matchScore > best.matchScore) best = m;
      }
      if (best && best.matchScore >= 30) {
        suggestions.push({
          offer: {
            id: offer.id,
            route: `${offer.pickupCity ?? offer.pickupCountry}→${offer.deliveryCity ?? offer.deliveryCountry}`,
            price: offer.price != null ? Number(offer.price) : null,
            currency: offer.currency,
          },
          vehicle: { id: best.vehicleId, name: best.vehicleName, licensePlate: best.licensePlate },
          matchScore: best.matchScore,
          recommendation: best.recommendation,
        });
      }
    }

    return suggestions.sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
  }

  /**
   * Open offers (NEW, ASSIGNED) without dead ones — as in LTL. The query
   * filters with a margin (statuses, `expiresAt`, loading at most 2 days back,
   * NEW not older than 7 days) before the limit; `deadReason` does the exact
   * test in the pickup country's zone. ASSIGNED has no age threshold. Dead
   * offers do not take places in the limit.
   */
  private async liveOffers(companyId: string, limit: number): Promise<{ offers: Offer[]; companyCountry: string | null }> {
    const now = new Date();
    const candidates = await this.prisma.offer.findMany({
      where: {
        companyId,
        status: { in: [OfferStatus.NEW, OfferStatus.ASSIGNED] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        pickupDate: { gte: pickupDateLowerBound(now) },
        NOT: { status: OfferStatus.NEW, createdAt: { lt: new Date(now.getTime() - MAX_AGE_MS) } },
      },
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_LIMIT,
    });
    const companyCountry = await this.companyCountryFor(companyId, candidates);
    const ctx = { now, companyCountry };
    const offers = candidates
      .filter((o) => deadReason(o, ctx, { ignoreAge: o.status === OfferStatus.ASSIGNED }) == null)
      .slice(0, limit);
    return { offers, companyCountry };
  }

  /** Why an offer opened directly is not live; ACCEPTED and later — null. */
  private notLiveReason(offer: Offer, companyCountry: string | null): DeadReason | null {
    if (offer.status === OfferStatus.EXPIRED) return 'EXPIRED';
    if (offer.status !== OfferStatus.NEW && offer.status !== OfferStatus.ASSIGNED) return null;
    return deadReason(offer, { now: new Date(), companyCountry }, { ignoreAge: offer.status === OfferStatus.ASSIGNED });
  }

  /**
   * The company country — only when some offer has a pickup country outside
   * the zone map (the fallback zone of the loading day). Otherwise no query.
   */
  private async companyCountryFor(companyId: string, offers: Offer[]): Promise<string | null> {
    if (offers.every((o) => countryTimeZone(o.pickupCountry))) return null;
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { country: true } });
    return company?.country ?? null;
  }

  // ── Scoring logic ─────────────────────────────────────────────────────────

  private scoreVehicleForOffer(vehicle: MatchVehicle, offer: Offer, companyCountry: string | null): VehicleMatch {
    return {
      vehicleId: vehicle.id,
      vehicleName: vehicle.brand && vehicle.model ? `${vehicle.brand} ${vehicle.model}` : vehicle.plateNumber,
      licensePlate: vehicle.licensePlate ?? vehicle.plateNumber ?? '—',
      ...this.score(vehicle, offer, companyCountry),
    };
  }

  private scoreOfferForVehicle(offer: Offer, vehicle: MatchVehicle, companyCountry: string | null): OfferMatch {
    return {
      offerId: offer.id,
      route: `${offer.pickupCity ?? offer.pickupCountry}→${offer.deliveryCity ?? offer.deliveryCountry}`,
      price: offer.price != null ? Number(offer.price) : null,
      currency: offer.currency,
      ...this.score(vehicle, offer, companyCountry),
    };
  }

  /**
   * Points and blocks. A vehicle KNOWN not to take the load (ADR, reefer,
   * payload, expired documents) scores 0 with the reasons, whatever the other
   * points. Missing data does not block: a component that cannot be computed
   * scores 0, and the missing fields are named in MATCH_DATA_UNKNOWN.
   */
  private score(vehicle: MatchVehicle, offer: Offer, companyCountry: string | null) {
    const loading = loadingDayOf(offer, companyCountry);
    const details = this.computeDetails(vehicle, offer, loading.day);
    const adr = adrCompatibility(offer, vehicle);
    const missing = unknownFields(vehicle, offer);
    const blockedBy = [...adr.reasons, ...this.usabilityBlocks(vehicle, offer, loading.day)];
    // A pickup country outside the map: the day is counted in a fallback zone — said (as LTL does).
    const zoneWarning = loading.assumed && offer.pickupDate != null
      ? [msg('OFFER_PICKUP_TIMEZONE_ASSUMED', { timeZone: loading.timeZone, ...(offer.pickupCountry && { pickupCountry: offer.pickupCountry.trim().toUpperCase() }) })]
      : [];
    const blocked = blockedBy.length > 0;
    const matchScore = blocked
      ? 0
      : details.typeMatch + details.available + details.capacityOk + details.locationMatch + details.docsValid;
    return {
      matchScore,
      matchDetails: details,
      recommendation: blocked ? BLOCKED_RECOMMENDATION : this.buildRecommendation(matchScore),
      blockedBy,
      warnings: [...adr.warnings, ...(missing.length ? [msg('MATCH_DATA_UNKNOWN', { fields: missing.join(',') })] : []), ...zoneWarning],
    };
  }

  /** Reasons the vehicle certainly cannot take the load — from known data only. */
  private usabilityBlocks(vehicle: MatchVehicle, offer: Offer, loadingDay: string): PlanMessage[] {
    const out: PlanMessage[] = [];
    if (requiresReefer(offer) && !isReefer(vehicle)) out.push(msg('MATCH_VEHICLE_NOT_REEFER'));
    if (offer.weightKg != null && vehicle.maxWeightKg) {
      const weightKg = Number(offer.weightKg);
      const maxWeightKg = Number(vehicle.maxWeightKg);
      if (maxWeightKg < weightKg) out.push(msg('MATCH_VEHICLE_CAPACITY_EXCEEDED', { weightKg, maxWeightKg }));
    }
    // Documents must be valid on the day of loading; an offer without a date — today.
    // Valid "until X" = valid all of day X: days are compared, not milliseconds.
    // The document day = the stored date (the form stores a day as midnight
    // UTC), the loading day — in the pickup country's time zone.
    if (documentDates(vehicle).some((d) => d && dateOnlyDay(d) < loadingDay)) out.push(msg('MATCH_VEHICLE_DOCUMENTS_EXPIRED'));
    return out;
  }

  private computeDetails(vehicle: MatchVehicle, offer: Offer, loadingDay: string): MatchDetails {
    return {
      typeMatch: this.calcTypeMatch(vehicle, offer),
      available: this.calcAvailability(vehicle, offer),
      capacityOk: this.calcCapacity(vehicle, offer),
      locationMatch: this.calcLocation(vehicle, offer),
      docsValid: this.calcDocs(vehicle, loadingDay),
    };
  }

  // a) Type match — 30 pts
  private calcTypeMatch(vehicle: MatchVehicle, offer: Offer): number {
    // Shared rule (common/reefer.ts): a TRUCK with a REEFER trailer is a reefer too,
    // and an offer that gives only a temperature is a reefer load too.
    const reefer = isReefer(vehicle);
    if (requiresReefer(offer)) {
      return reefer ? 30 : 0;
    }
    // Normal cargo
    if (reefer) return 20; // can carry normal, slight waste
    return 30;
  }

  // b) Availability — 25 pts
  private calcAvailability(vehicle: MatchVehicle, offer: Offer): number {
    const status: string = vehicle.status ?? '';
    if (status === 'AVAILABLE') {
      // Check availableFrom
      if (vehicle.availableFrom) {
        const pickupDate = offer.pickupDate ? new Date(offer.pickupDate) : null;
        const availFrom = new Date(vehicle.availableFrom);
        if (pickupDate && availFrom > pickupDate) return 10; // available, but only after pickup
      }
      return 25;
    }
    if (status === 'RETURNING') return 12;
    return 0; // IN_TRANSIT, LOADING (VehicleStatus has no maintenance / inactive state)
  }

  // c) Capacity — 20 pts. An unknown weight or payload = 0 (before: 20 / 10, "assume it fits").
  private calcCapacity(vehicle: MatchVehicle, offer: Offer): number {
    if (offer.weightKg === null || !vehicle.maxWeightKg) return 0;
    const weight = Number(offer.weightKg);
    const cap = Number(vehicle.maxWeightKg);
    if (cap >= weight) return 20;
    if (cap >= weight * 0.8) return 10; // close
    return 0;
  }

  // d) Location — 15 pts
  // An unknown vehicle country = 0 (before: 5, "neutral"), named in MATCH_DATA_UNKNOWN.
  private calcLocation(vehicle: MatchVehicle, offer: Offer): number {
    if (!vehicle.currentCountry || !offer.pickupCountry) return 0;
    return vehicle.currentCountry.toUpperCase() === offer.pickupCountry.toUpperCase() ? 15 : 0;
  }

  // e) Docs validity — 10 pts, proportionally: each of the three dates known and
  // valid on the loading day (like the block) = 1/3, rounded (0 / 3 / 7 / 10).
  // Unknown or expired = 0 (before: no dates = 10, "assume valid").
  private calcDocs(vehicle: MatchVehicle, loadingDay: string): number {
    const valid = documentDates(vehicle).filter((d) => d && dateOnlyDay(d) >= loadingDay).length;
    return Math.round((10 * valid) / DOCUMENT_FIELDS.length);
  }

  private buildRecommendation(score: number): string {
    if (score >= 80) return 'Doskonałe dopasowanie — zdecydowanie warto przypisać.';
    if (score >= 60) return 'Dobre dopasowanie — pojazd odpowiada wymaganiom oferty.';
    if (score >= 40) return 'Przeciętne dopasowanie — warto rozważyć przy braku lepszych opcji.';
    return 'Słabe dopasowanie — dostępne są prawdopodobnie lepsze pojazdy dla tej trasy.';
  }
}

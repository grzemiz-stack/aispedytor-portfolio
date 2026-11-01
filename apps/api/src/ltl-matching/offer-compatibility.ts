/**
 * Offer ↔ vehicle compatibility for part loads (docs/decisions.md §6).
 *
 * Two layers:
 *  - a DEAD offer (pickup date passed, past `expiresAt`, older than 7 days)
 *    disappears without a reason — it tells the forwarder nothing;
 *  - an offer INCOMPATIBLE with this vehicle (ADR, reefer, availability) is
 *    returned with the reason as a code, so it is clear why it is not listed.
 *
 * Pure functions, no database — the whole rule can be tested directly.
 */
import { msg, type PlanMessage } from '../common/plan-messages';
import { calendarDate, pickupTimeZone, resolvePickupTimeZone } from '../common/country-timezone';
import { isReefer, requiresReefer } from '../common/reefer';
import { adrCompatibility } from '../common/adr';

/** The same threshold as `OfferExpiryTask`. */
export const MAX_OFFER_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CompatOffer {
  pickupCountry?: string | null;
  pickupDate?: Date | string | null;
  expiresAt?: Date | string | null;
  createdAt?: Date | string | null;
  isAdr?: boolean | null;
  adrClass?: string | null;
  isFrigo?: boolean | null;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
}

export interface CompatVehicle {
  hasAdr?: boolean | null;
  adrClasses?: string[] | null;
  vehicleType?: string | null;
  trailerType?: string | null;
  availableFrom?: Date | string | null;
  /** Trailers stored as separate records (`parentVehicleId`). */
  trailers?: { vehicleType?: string | null; trailerType?: string | null }[] | null;
}

export interface CompatContext {
  now: Date;
  /** The company's country — the fallback time zone when the pickup country is not on the map. */
  companyCountry?: string | null;
}

export interface CompatResult {
  /** Rejection reasons; empty = compatible. */
  reasons: PlanMessage[];
  /** Warnings for a compatible offer, shown on its card. */
  warnings: PlanMessage[];
}

const toDate = (v: Date | string | null | undefined): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ── Layer 1: dead offer ─────────────────────────────────────────────────

/**
 * An offer not worth showing to anyone. A missing date does not make an offer
 * dead — `pickupDate` and `createdAt` are required in the database, a missing
 * one only happens in test data, and guessing "too old" would be worse than
 * letting it through.
 */
export function isDeadOffer(offer: CompatOffer, ctx: CompatContext): boolean {
  return deadReason(offer, ctx) != null;
}

/** Why an offer is dead — so a screen can say exactly. */
export type DeadReason = 'EXPIRED' | 'TOO_OLD' | 'PICKUP_PASSED';

/**
 * Why the offer is dead, or `null` — the same rule as `isDeadOffer` (LTL),
 * with the reason named for matching.
 * `ignoreAge` — no age threshold (an ASSIGNED offer: a dispatcher is working on
 * it, and the expiry task leaves it alone too); a passed loading day and
 * `expiresAt` still apply.
 */
export function deadReason(offer: CompatOffer, ctx: CompatContext, opts: { ignoreAge?: boolean } = {}): DeadReason | null {
  const expiresAt = toDate(offer.expiresAt);
  if (expiresAt && expiresAt.getTime() <= ctx.now.getTime()) return 'EXPIRED';

  const createdAt = toDate(offer.createdAt);
  if (!opts.ignoreAge && createdAt && ctx.now.getTime() - createdAt.getTime() > MAX_OFFER_AGE_DAYS * DAY_MS) return 'TOO_OLD';

  const pickup = toDate(offer.pickupDate);
  if (pickup) {
    const tz = pickupTimeZone(offer.pickupCountry, ctx.companyCountry);
    // Compare DAYS in the pickup country's time zone, not instants: an
    // imported date is UTC midnight, and `pickupDate < now` would drop
    // today's offers.
    if (calendarDate(pickup, tz) < calendarDate(ctx.now, tz)) return 'PICKUP_PASSED';
  }
  return null;
}

/**
 * The earliest pickup date that may be filtered out in the query already.
 * The query does not know each offer's time zone, so it keeps a two-day
 * margin — `isDeadOffer` does the exact day test.
 */
export function pickupDateLowerBound(now: Date): Date {
  return new Date(now.getTime() - 2 * DAY_MS);
}

// ── ADR ──────────────────────────────────────────────────────────────────

// Rule shared with `matching` — see common/adr.ts.
export { parseAdrClasses, type ParsedAdrClasses } from '../common/adr';

function checkAdr(offer: CompatOffer, vehicle: CompatVehicle, out: CompatResult): void {
  const r = adrCompatibility(offer, vehicle);
  out.reasons.push(...r.reasons);
  out.warnings.push(...r.warnings);
}

// ── Reefer ───────────────────────────────────────────────────────────────

// Rule shared with `matching` and `risk-analysis` — see common/reefer.ts.
export { isReefer, requiresReefer };

function temperatureParams(offer: CompatOffer): Record<string, number> {
  return {
    ...(offer.temperatureMin != null && { temperatureMin: offer.temperatureMin }),
    ...(offer.temperatureMax != null && { temperatureMax: offer.temperatureMax }),
  };
}

function checkReefer(offer: CompatOffer, vehicle: CompatVehicle, out: CompatResult): void {
  if (!requiresReefer(offer)) return;
  if (!isReefer(vehicle)) {
    out.reasons.push(msg('OFFER_REQUIRES_REEFER', temperatureParams(offer)));
    return;
  }
  // Vehicles have no temperature range (docs/decisions.md §6) — whether it
  // holds the given temperature is unknown. Only when the offer gives one.
  if (offer.temperatureMin != null || offer.temperatureMax != null) {
    out.warnings.push(msg('OFFER_TEMPERATURE_UNVERIFIED', temperatureParams(offer)));
  }
}

// ── Vehicle availability ─────────────────────────────────────────────────

function checkAvailability(offer: CompatOffer, vehicle: CompatVehicle, ctx: CompatContext, out: CompatResult): void {
  const availableFrom = toDate(vehicle.availableFrom);
  const pickup = toDate(offer.pickupDate);
  if (!availableFrom || !pickup) return;
  const tz = pickupTimeZone(offer.pickupCountry, ctx.companyCountry);
  const pickupDay = calendarDate(pickup, tz);
  const availableDay = calendarDate(availableFrom, tz);
  // The same day passes — the pickup hour is not known.
  if (pickupDay < availableDay) {
    out.reasons.push(
      msg('OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE', { pickupDate: pickupDay, availableFrom: availableDay }),
    );
  }
}

// ── All checks ───────────────────────────────────────────────────────────

/**
 * Pickup country not on the map: the pickup day is computed in an assumed
 * time zone (the company's country, or Warsaw). Say so — near midnight this
 * can decide between "today" and "yesterday".
 */
function checkTimeZone(offer: CompatOffer, ctx: CompatContext, out: CompatResult): void {
  if (toDate(offer.pickupDate) == null) return;
  const tz = resolvePickupTimeZone(offer.pickupCountry, ctx.companyCountry);
  if (!tz.assumed) return;
  const country = offer.pickupCountry?.trim().toUpperCase();
  out.warnings.push(
    msg('OFFER_PICKUP_TIMEZONE_ASSUMED', { timeZone: tz.timeZone, ...(country && { pickupCountry: country }) }),
  );
}

/** All incompatibility reasons at once — the forwarder sees the full picture. */
export function checkCompatibility(offer: CompatOffer, vehicle: CompatVehicle, ctx: CompatContext): CompatResult {
  const out: CompatResult = { reasons: [], warnings: [] };
  checkTimeZone(offer, ctx, out);
  checkAvailability(offer, vehicle, ctx, out);
  checkAdr(offer, vehicle, out);
  checkReefer(offer, vehicle, out);
  return out;
}

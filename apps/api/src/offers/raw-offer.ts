/**
 * Raw offer accepted by POST /api/offers/import, and its normalisation.
 *
 * Offers enter the system through the offer form (POST /api/offers), the
 * e-mail module (`email-agent`) and this import endpoint.
 */

import { OfferSource } from '@prisma/client';

export interface RawOffer {
  externalId?: string;
  pickupCity: string;
  pickupCountry: string;
  pickupPostal?: string;
  deliveryCity: string;
  deliveryCountry: string;
  deliveryPostal?: string;
  pickupDate: string;
  deliveryDate?: string;
  cargoType?: string;
  weightKg?: number;
  volumeM3?: number;
  price?: number;
  currency?: string;
  distanceKm?: number;
  pricePerKm?: number;
  isAdr?: boolean;
  isFrigo?: boolean;
  temperatureMin?: number;
  temperatureMax?: number;
  contactPhone?: string;
  contactEmail?: string;
  clientName?: string;
}

/**
 * Source keys accepted in the `source` field (case-insensitive).
 *
 * The exchange values (TRANS_EU, TIMOCOM, TELEROUTE) stay in the OfferSource
 * enum because existing rows use them, but they are no longer produced — an
 * import with an unknown key is stored as GENERIC.
 */
const SOURCE_KEY_MAP: Record<string, OfferSource> = {
  manual: OfferSource.MANUAL,
  api: OfferSource.API,
  email: OfferSource.EMAIL,
  generic: OfferSource.GENERIC,
};

/** Maps the `source` field to an OfferSource value (unknown or missing → GENERIC). */
export function resolveSourceKey(source: string): OfferSource {
  return SOURCE_KEY_MAP[source?.toLowerCase()] ?? OfferSource.GENERIC;
}

function normalizeCountry(country: string): string {
  if (!country) return country;
  const code = country.trim().toUpperCase();
  return code.length === 2 ? code : country.trim();
}

function normalizeDate(date: string): string {
  if (!date) return date;
  // DD.MM.YYYY → YYYY-MM-DD
  const dot = date.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;
  // DD/MM/YYYY → YYYY-MM-DD
  const slash = date.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return date;
}

/**
 * Tidies an offer before saving: trims city names, upper-cases two-letter
 * country codes and the currency, turns DD.MM.YYYY and DD/MM/YYYY dates into
 * YYYY-MM-DD, and converts weightKg, price and distanceKm to numbers.
 *
 * It does not fill gaps — a missing field stays missing, except the currency:
 * a missing currency becomes EUR.
 */
export function normalizeRawOffer(raw: RawOffer): RawOffer {
  return {
    ...raw,
    pickupCity: raw.pickupCity?.trim() || raw.pickupCity,
    deliveryCity: raw.deliveryCity?.trim() || raw.deliveryCity,
    pickupCountry: normalizeCountry(raw.pickupCountry),
    deliveryCountry: normalizeCountry(raw.deliveryCountry),
    currency: raw.currency?.toUpperCase() || 'EUR',
    pickupDate: raw.pickupDate ? normalizeDate(raw.pickupDate) : raw.pickupDate,
    deliveryDate: raw.deliveryDate ? normalizeDate(raw.deliveryDate) : undefined,
    weightKg: raw.weightKg != null ? Number(raw.weightKg) : undefined,
    price: raw.price != null ? Number(raw.price) : undefined,
    distanceKm: raw.distanceKm != null ? Number(raw.distanceKm) : undefined,
  };
}

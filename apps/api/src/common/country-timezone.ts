/**
 * A country's time zone and the calendar day in that zone.
 *
 * A "date without a time" on an offer is a calendar day IN THE PICKUP
 * COUNTRY, not in our zone and not in UTC. An offer from GB "for today" is
 * still current at 23:30 London time, although in Warsaw it is already
 * tomorrow.
 *
 * The map is explicit and short and covers the countries trucks drive to.
 * Countries with territories in other zones are reduced to their mainland
 * (Spain without the Canaries, Portugal without the Azores) — irrelevant for
 * road transport within Europe.
 */

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export const COUNTRY_TIMEZONES: Record<string, string> = {
  PL: 'Europe/Warsaw',
  DE: 'Europe/Berlin',
  CZ: 'Europe/Prague',
  SK: 'Europe/Bratislava',
  AT: 'Europe/Vienna',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  LU: 'Europe/Luxembourg',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DK: 'Europe/Copenhagen',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  CH: 'Europe/Zurich',
  LT: 'Europe/Vilnius',
  LV: 'Europe/Riga',
  EE: 'Europe/Tallinn',
  HU: 'Europe/Budapest',
  RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  SI: 'Europe/Ljubljana',
  RS: 'Europe/Belgrade',
  UA: 'Europe/Kyiv',
  TR: 'Europe/Istanbul',
};

/** The country's zone from the map, or `null` when the country is not in the map. */
export function countryTimeZone(country?: string | null): string | null {
  const code = country?.trim().toUpperCase();
  return (code && COUNTRY_TIMEZONES[code]) || null;
}

/**
 * Zone for the pickup day: the pickup country; when it is not in the map —
 * the company's country; when that is missing too — the default zone.
 */
export function pickupTimeZone(pickupCountry?: string | null, companyCountry?: string | null): string {
  return resolvePickupTimeZone(pickupCountry, companyCountry).timeZone;
}

export interface PickupTimeZone {
  timeZone: string;
  /** true = the pickup country is not in the map, a substitute zone was assumed. */
  assumed: boolean;
}

/** Like `pickupTimeZone`, but also says whether the zone was assumed — no silent guessing. */
export function resolvePickupTimeZone(
  pickupCountry?: string | null,
  companyCountry?: string | null,
): PickupTimeZone {
  const own = countryTimeZone(pickupCountry);
  if (own) return { timeZone: own, assumed: false };
  return { timeZone: countryTimeZone(companyCountry) ?? DEFAULT_TIMEZONE, assumed: true };
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Calendar day of an instant in the given zone, as `YYYY-MM-DD`.
 * Strings in this format compare lexicographically like dates.
 */
export function calendarDate(instant: Date, timeZone: string): string {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    // en-CA gives YYYY-MM-DD directly; formatToParts so as not to rely on
    // the order of fields in the output of `format`.
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    FORMATTERS.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The loading day: the day, the zone and whether the zone was assumed. */
export interface PickupDay extends PickupTimeZone {
  day: string;
}

/**
 * The offer's loading day in the pickup country's time zone — one rule for
 * LTL, matching and negotiation (docs/decisions.md §6). A country outside the
 * map → the company country, then Warsaw (`assumed: true` — said with the
 * code OFFER_PICKUP_TIMEZONE_ASSUMED). An offer without a date — today in that
 * zone. A date without a time (00:00Z from an import) stays the same day in
 * Europe.
 */
export function pickupDay(
  pickupDate: Date | string | null | undefined,
  pickupCountry: string | null | undefined,
  companyCountry: string | null | undefined,
  now: Date = new Date(),
): PickupDay {
  const zone = resolvePickupTimeZone(pickupCountry, companyCountry);
  const at = pickupDate == null ? now : new Date(pickupDate);
  return { ...zone, day: calendarDate(at, zone.timeZone) };
}

/**
 * The day of a date without a time (a document expiry date from the form,
 * `YYYY-MM-DD`, stored as midnight UTC) — its stored day, i.e. the UTC day. A
 * document valid "until X" is valid all of day X.
 */
export function dateOnlyDay(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** The difference in days between two `YYYY-MM-DD` days (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

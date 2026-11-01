/**
 * Demo scenario for the LTL screen — route Poznań, PL → Berlin, DE.
 *
 * Repeatable: every seed run DELETES the offers with the `DEMO_LTL_PREFIX`
 * prefix and creates them again with dates counted from `now` (pickup
 * today+1 … today+5). Other data is not touched. So `prisma db seed` on the
 * day of a demo gives live offers, not expired ones.
 *
 * No network needed: the offers have coordinates, and the route ends are
 * written to `geocode_cache` — the LTL service reads them from there, as in
 * production.
 *
 * What it shows (vehicle SEED-MEGA1, company with a cost of 4.20 PLN/km):
 *  - offers in PLN, EUR and GBP — ranked by profit in the company's currency;
 *  - an offer without a price — at the end, with a threshold price;
 *  - an offer from a contractor with a payment risk — a code next to the amount;
 *  - an ADR offer — in the collapsed list of incompatible offers (the MEGA has no ADR);
 *  - an offer with a detour (Leszno, about 66 km) — the cost per km of the detour
 *    (the detour toll only with a toll provider); it stays within the default
 *    100 km detour limit.
 *
 * Tests: test/unit/seed-demo-ltl.spec.ts (definitions) and
 * test/integration/demo-ltl.int-spec.ts (seed + search, tools/demo-test.sh).
 */
import type { PrismaClient } from '@prisma/client';

export const DEMO_LTL_PREFIX = 'LTLDEMO-';

/** What is typed into the LTL screen form — exactly these strings. */
export const DEMO_ROUTE = {
  vehicleId: 'seed-vehicle-mega2',
  from: 'Poznań, PL',
  to: 'Berlin, DE',
} as const;

const POZNAN = { lat: 52.4082663, lng: 16.9335199 };
const BERLIN = { lat: 52.5173885, lng: 13.3951309 };
const SWIEBODZIN = { lat: 52.2475, lng: 15.5336 };
const FRANKFURT_ODER = { lat: 52.3471, lng: 14.5506 };
const LESZNO = { lat: 51.8406, lng: 16.5749 };

/**
 * `geocode_cache` keys for the route ends — `GeocodingService.normalize`
 * (trim, lower case, single spaces). A test checks they match.
 */
export const DEMO_GEOCODE_CACHE = [
  { query: 'poznań, pl', ...POZNAN },
  { query: 'berlin, de', ...BERLIN },
] as const;

/** Contractors from the seed (fixed ids from section 9, "Extra contractors", of seed.ts). */
export const DEMO_CONTRACTORS = {
  /** reliability 98, payment rating 5 */
  good: 'seed-contractor-Seed-Alpen Transport GmbH',
  /** reliability 95, payment rating 5 */
  good2: 'seed-contractor-Seed-Blitz Spedition AG',
  /** reliability 65, payment rating 3 — no risk */
  average: 'seed-contractor-Seed-PolTrans Express',
  /** payment rating 2 → PAYMENT risk (common/counterparty-risk.ts) */
  risky: 'seed-contractor-Seed-Magyar Szállítás Kft',
} as const;

/** Day `now` + n at 08:00 UTC — the calendar day does not depend on the machine's time zone. */
export function demoDay(now: Date, n: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n, 8, 0, 0));
  return d;
}

type Point = { lat: number; lng: number };
const leg = (pickupCity: string, pickup: Point, deliveryCity: string, delivery: Point, deliveryCountry = 'DE') => ({
  pickupCity, pickupCountry: 'PL', pickupLat: pickup.lat, pickupLng: pickup.lng,
  deliveryCity, deliveryCountry, deliveryLat: delivery.lat, deliveryLng: delivery.lng,
});

/** Demo offer definitions relative to `now` — nothing is written to the database. */
export function demoLtlOffers(now: Date, companyId: string) {
  const base = {
    companyId,
    source: 'MANUAL' as const,
    status: 'NEW' as const,
    createdAt: now,
    expiresAt: null,
    publishStatus: 'none',
  };
  return [
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}01-PLN`,
      ...leg('Poznań', POZNAN, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 1), price: 1200, currency: 'PLN',
      weightKg: 1500, lengthM: 2.4, palletCount: 6, cargoType: 'Palety EUR — elektronika',
      contractorId: DEMO_CONTRACTORS.good,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}02-EUR`,
      ...leg('Poznań', POZNAN, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 2), price: 1200, currency: 'EUR',
      weightKg: 2000, lengthM: 1.2, palletCount: 3, cargoType: 'Części samochodowe',
      contractorId: DEMO_CONTRACTORS.good2,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}03-GBP`,
      ...leg('Świebodzin', SWIEBODZIN, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 3), price: 1150, currency: 'GBP',
      weightKg: 1000, lengthM: 1.2, palletCount: 3, cargoType: 'Kosmetyki — kartony na paletach',
      contractorId: DEMO_CONTRACTORS.good2,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}04-NOPRICE`,
      ...leg('Poznań', POZNAN, 'Frankfurt (Oder)', FRANKFURT_ODER),
      pickupDate: demoDay(now, 4), price: null, currency: 'PLN',
      weightKg: 800, lengthM: 0.8, palletCount: 2, cargoType: 'Tekstylia — cena do uzgodnienia',
      contractorId: DEMO_CONTRACTORS.average,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}05-RISK`,
      ...leg('Poznań', POZNAN, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 5), price: 1250, currency: 'PLN',
      weightKg: 1200, lengthM: 1.2, palletCount: 3, cargoType: 'AGD — drobne',
      contractorId: DEMO_CONTRACTORS.risky,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}06-ADR`,
      ...leg('Poznań', POZNAN, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 2), price: 1500, currency: 'EUR',
      weightKg: 1800, lengthM: 1.6, palletCount: 4, cargoType: 'Farby i rozpuszczalniki',
      isAdr: true, adrClass: '3',
      contractorId: DEMO_CONTRACTORS.good,
    },
    {
      ...base, externalId: `${DEMO_LTL_PREFIX}07-DETOUR`,
      ...leg('Leszno', LESZNO, 'Berlin', BERLIN),
      pickupDate: demoDay(now, 1), price: 900, currency: 'EUR',
      weightKg: 1500, lengthM: 1.2, palletCount: 3, cargoType: 'Meble — paczki płaskie',
      contractorId: DEMO_CONTRACTORS.average,
    },
  ];
}

/** Write: delete the old demo offers, create new ones; put the route ends into the cache. */
export async function seedDemoLtl(prisma: PrismaClient, companyId: string, now: Date) {
  const removed = await prisma.offer.deleteMany({
    where: { companyId, externalId: { startsWith: DEMO_LTL_PREFIX } },
  });
  const offers = demoLtlOffers(now, companyId);
  await prisma.offer.createMany({ data: offers });
  for (const g of DEMO_GEOCODE_CACHE) {
    await prisma.geocodeCache.upsert({
      where: { query: g.query },
      create: { query: g.query, lat: g.lat, lng: g.lng, found: true, fetchedAt: now },
      update: { lat: g.lat, lng: g.lng, found: true, fetchedAt: now },
    });
  }
  return { removed: removed.count, created: offers.length };
}

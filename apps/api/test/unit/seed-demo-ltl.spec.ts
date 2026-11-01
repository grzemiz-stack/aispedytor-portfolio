/**
 * LTL demo scenario — the offer definitions (no database). Seed + search:
 * test/integration/demo-ltl.int-spec.ts (run by tools/demo-test.sh, part of
 * the full check tools/bramka.sh).
 */
import {
  DEMO_CONTRACTORS, DEMO_GEOCODE_CACHE, DEMO_LTL_PREFIX, DEMO_ROUTE, demoLtlOffers,
} from '../../prisma/seed-demo-ltl';
import { GeocodingService } from '../../src/geocoding/geocoding.service';

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

describe.each([
  ['an ordinary day', new Date('2026-10-04T14:53:00Z')],
  ['end of February in a leap year', new Date('2028-02-28T23:30:00Z')],
  ['New Year’s Eve', new Date('2030-12-31T06:00:00Z')],
])('demo LTL offers seeded on %s', (_label, now) => {
  const offers = demoLtlOffers(now, 'comp-1');

  it('pickup is today+1 … today+5, counted from the seed run — never a fixed date', () => {
    const days = offers.map(o => (dayOf(o.pickupDate) - dayOf(now)) / DAY);
    expect(Math.min(...days)).toBe(1);
    expect(Math.max(...days)).toBe(5);
    expect(days.every(d => d >= 1 && d <= 5)).toBe(true);
  });

  it('created now (offers older than 7 days are dropped by LTL)', () => {
    expect(offers.every(o => o.createdAt.getTime() === now.getTime())).toBe(true);
  });
});

describe('demo LTL offers — what the scenario shows', () => {
  const offers = demoLtlOffers(new Date('2026-10-04T12:00:00Z'), 'comp-1');

  it('all carry the prefix the seed deletes by, and are NEW', () => {
    expect(offers.every(o => o.externalId.startsWith(DEMO_LTL_PREFIX) && o.status === 'NEW')).toBe(true);
    expect(new Set(offers.map(o => o.externalId)).size).toBe(offers.length);
  });

  it('every offer has coordinates at both ends — no geocoding needed', () => {
    for (const o of offers) {
      expect([o.pickupLat, o.pickupLng, o.deliveryLat, o.deliveryLng].every(Number.isFinite)).toBe(true);
    }
  });

  it('prices in PLN, EUR and GBP, and exactly one without a price', () => {
    expect(new Set(offers.filter(o => o.price != null).map(o => o.currency))).toEqual(new Set(['PLN', 'EUR', 'GBP']));
    expect(offers.filter(o => o.price == null)).toHaveLength(1);
  });

  it('one offer from the contractor with a payment risk, one ADR offer', () => {
    expect(offers.filter(o => o.contractorId === DEMO_CONTRACTORS.risky)).toHaveLength(1);
    expect(offers.filter(o => (o as any).isAdr === true)).toHaveLength(1);
  });

  it('every offer is measurable (weight and length) — none lands in "unmeasurable"', () => {
    expect(offers.every(o => o.weightKg > 0 && o.lengthM > 0)).toBe(true);
  });
});

describe('demo route — the cache keys are what the geocoder looks up', () => {
  it.each([[DEMO_ROUTE.from, 0], [DEMO_ROUTE.to, 1]])('"%s" → cache key', (query, i) => {
    expect(GeocodingService.normalize(query)).toBe(DEMO_GEOCODE_CACHE[i].query);
  });
});

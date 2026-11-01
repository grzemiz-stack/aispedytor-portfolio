/**
 * RoutePlannerService — helper calculators and reference data.
 * Pure arithmetic and table lookups. No I/O.
 */
import { NotFoundException } from '@nestjs/common';
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { MemoryCacheService } from '../../src/common/cache/memory-cache.service';
import { TRUCK_RESTRICTIONS } from '../../src/route-planner/truck-restrictions.data';
import {
  getVignetteRequirement,
  getRequiredVignetteCountries,
  getRouteVignetteRequirements,
} from '../../src/route-planner/vignette-requirements.data';
import {
  getHub,
  getHubDistance,
  getOrEstimateDistance,
  estimateRoadDistance,
  findNearestHub,
} from '../../src/route-planner/hub-distances.data';

describe('RoutePlannerService — private calculators', () => {
  let service: RoutePlannerService;
  let cache: MemoryCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService();
    service = new RoutePlannerService(null as any, cache, null as any);
  });
  afterEach(() => cache.onModuleDestroy());

  // calculateFuelCost removed: the route cost = the company cost per km × km + toll (common/offer-cost.ts).

  describe('calculateMargin', () => {
    // The cost from common/offer-cost.ts — here only its total in EUR.
    const margin = (rate: number, cur: string, _pln: number, eur: number, km: number) =>
      (service as any).calculateMargin(rate, cur, { ok: true, totalEUR: eur, messages: [] }, km);

    it('for EUR compares the rate with the cost in EUR', () => {
      expect(margin(1000, 'EUR', 3000, 700, 500)).toEqual({
        freightRate: 1000,
        currency: 'EUR',
        totalCostInCurrency: 700,
        marginValue: 300,
        marginPercent: 30,
        pricePerKm: 2,
        complete: true,
        messages: [],
      });
    });

    it('for PLN compares the rate with the cost converted from EUR (700 EUR = 3043.48 PLN)', () => {
      expect(margin(4000, 'PLN', 3000, 700, 500)).toMatchObject({
        totalCostInCurrency: 3043.48,
        marginValue: 956.52,
        marginPercent: 23.91,
      });
    });

    it('without a cost (e.g. no company cost per km): no margin, the cost code passes through', () => {
      expect((service as any).calculateMargin(1000, 'EUR', { ok: false, messages: [{ code: 'OFFER_COST_RATE_MISSING' }] }, 500)).toEqual({
        freightRate: 1000, currency: 'EUR', totalCostInCurrency: null, marginValue: null, marginPercent: null, pricePerKm: 2, complete: true,
        messages: [{ code: 'OFFER_COST_RATE_MISSING' }],
      });
    });

    it('returns a negative margin when the cost exceeds the rate', () => {
      const r = margin(500, 'EUR', 3000, 700, 500);
      expect(r.marginValue).toBe(-200);
      expect(r.marginPercent).toBe(-40);
    });

    it('does not divide by zero with a rate of 0', () => {
      expect(margin(0, 'EUR', 3000, 700, 500).marginPercent).toBe(0);
    });

    it('does not divide by zero with a distance of 0', () => {
      expect(margin(1000, 'EUR', 3000, 700, 0).pricePerKm).toBe(0);
    });

    // A currency other than PLN/EUR is converted from the EUR cost, never treated as PLN.
    it('another currency with a rate: cost from EUR through common/fx (700 EUR = 608.70 GBP)', () => {
      expect(margin(1000, 'GBP', 3000, 700, 500)).toMatchObject({
        totalCostInCurrency: 608.7, marginValue: 391.3, marginPercent: 39.13,
        messages: [{ code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'GBP', rate: 0.8696 } }],
      });
    });

    it('a currency without a rate: no margin, with a code — not computed as PLN', () => {
      expect(margin(1000, 'USD', 3000, 700, 500)).toEqual({
        freightRate: 1000, currency: 'USD', totalCostInCurrency: null, marginValue: null, marginPercent: null, pricePerKm: 2, complete: true,
        messages: [{ code: 'CURRENCY_CONVERSION_UNAVAILABLE', params: { from: 'EUR', to: 'USD' } }],
      });
    });
  });

  describe('round', () => {
    const round = (n: number) => (service as any).round(n);

    it.each([
      [2.344, 2.34],
      [2.345, 2.35],
      [-1.234, -1.23],
      [0, 0],
      [6.7000000001, 6.7],
    ])('round(%p) = %p', (input, expected) => {
      expect(round(input)).toBe(expected);
    });

    it('round(1.005) gives 1, not 1.01 (floating-point representation)', () => {
      // 1.005 * 100 === 100.49999999999999 -> Math.round -> 100
      expect(round(1.005)).toBe(1);
      // for toll/fuel amounts this means rounding down by half a grosz in such cases
    });
  });

  describe('formatDuration', () => {
    const fmt = (s: number) => (service as any).formatDuration(s);

    it.each([
      [0, '0h 0min'],
      [3600, '1h 0min'],
      [5400, '1h 30min'],
      [86400, '24h 0min'],
    ])('formatDuration(%p) = %p', (input, expected) => {
      expect(fmt(input)).toBe(expected);
    });

    it('rounding the minutes gives "60min" instead of carrying over to the next hour', () => {
      expect(fmt(3599)).toBe('0h 60min');   // should be 1h 0min
      expect(fmt(7199)).toBe('1h 60min');   // should be 2h 0min
    });
  });

  describe('getCountryRestrictions / getAllCountryRestrictions', () => {
    it('returns data for a known country, in any letter case', () => {
      expect(service.getCountryRestrictions('pl').country).toBe('Polska');
      expect(service.getCountryRestrictions('PL').countryCode).toBe('PL');
    });

    it('throws NotFoundException for an unknown code', () => {
      expect(() => service.getCountryRestrictions('XX')).toThrow(NotFoundException);
    });

    it('the second call is served from the cache (the same object)', () => {
      expect(service.getCountryRestrictions('PL')).toBe(service.getCountryRestrictions('PL'));
    });

    it('returns all 20 countries', () => {
      expect(service.getAllCountryRestrictions()).toHaveLength(20);
    });
  });
});

describe('truck-restrictions.data', () => {
  it('every country in the table has a name, a toll system description and weight/height limits — no toll amounts', () => {
    Object.entries(TRUCK_RESTRICTIONS).forEach(([code, data]) => {
      expect(data.countryCode).toBe(code);
      expect(data.country).toBeTruthy();
      expect(data.tollInfo).toBeTruthy();
      expect('toll' in data).toBe(false);
      expect(data.maxGrossWeightKg).toBeGreaterThan(0);
      expect(data.maxHeightM).toBeGreaterThan(0);
    });
  });
});

describe('vignette-requirements.data', () => {
  it('returns the requirement for a known country, in any letter case', () => {
    const pl = getVignetteRequirement('pl');
    expect(pl).toBeDefined();
    expect(getVignetteRequirement('PL')).toBe(pl);
  });

  it('returns undefined for an unknown country', () => {
    expect(getVignetteRequirement('XX')).toBeUndefined();
  });

  it('the list of countries requiring a vignette is non-empty and has no duplicates', () => {
    const list = getRequiredVignetteCountries();
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list).size).toBe(list.length);
  });

  it('for a route returns only countries that have an entry in the table', () => {
    const res = getRouteVignetteRequirements(['PL', 'XX', 'DE']);
    expect(res.every((r) => r !== undefined)).toBe(true);
    expect(res.length).toBeLessThanOrEqual(2);
  });

  it('an empty route gives an empty list', () => {
    expect(getRouteVignetteRequirements([])).toEqual([]);
  });
});

describe('hub-distances.data', () => {
  it('getHub accepts any letter case and returns undefined for an unknown code', () => {
    expect(getHub('waw')!.name).toBe('Warszawa');
    expect(getHub('ZZZ')).toBeUndefined();
  });

  it('getHubDistance works in both directions (key sorted alphabetically)', () => {
    const ab = getHubDistance('WAW', 'BER');
    const ba = getHubDistance('BER', 'WAW');
    expect(ab).toBe(ba);
    expect(ab!.distanceKm).toBe(575);
  });

  it('estimateRoadDistance applies the road factor 1.3', () => {
    const straightLine = estimateRoadDistance(52.2297, 21.0122, 52.52, 13.405, 1.0);
    const byRoad = estimateRoadDistance(52.2297, 21.0122, 52.52, 13.405);
    expect(byRoad.distanceKm).toBe(Math.round(straightLine.distanceKm * 1.3));
  });

  it('estimateRoadDistance computes the time at 70 km/h', () => {
    const r = estimateRoadDistance(52.2297, 21.0122, 52.52, 13.405);
    expect(r.estimatedDrivingMinutes).toBe(Math.round((r.distanceKm / 70) * 60));
  });

  it('estimateRoadDistance returns 0 for the same point', () => {
    expect(estimateRoadDistance(52.2297, 21.0122, 52.2297, 21.0122)).toEqual({
      distanceKm: 0,
      estimatedDrivingMinutes: 0,
    });
  });

  it('getOrEstimateDistance prefers the table value to the estimate', () => {
    expect(getOrEstimateDistance('WAW', 'BER').distanceKm).toBe(575);
    expect(getOrEstimateDistance('WAW', 'BER')).toBe(getHubDistance('WAW', 'BER'));
  });

  it('getOrEstimateDistance reports an unknown hub instead of throwing', () => {
    const r = getOrEstimateDistance('WAW', 'ZZZ');
    expect(r.distanceKm).toBe(0);
    expect(r.notes).toBe('Unknown hub code(s)');
  });

  it('findNearestHub returns the hub at the given coordinates', () => {
    expect(findNearestHub(52.2297, 21.0122).code).toBe('WAW');
  });

  it('the haversine × 1.3 estimate is above the table road distance', () => {
    // WAW→BER: table 575 km, estimate ~684 km (+19%)
    const est = estimateRoadDistance(52.2297, 21.0122, 52.52, 13.405).distanceKm;
    const tableKm = getHubDistance('WAW', 'BER')!.distanceKm;
    expect(est).toBeGreaterThan(tableKm);
  });
});

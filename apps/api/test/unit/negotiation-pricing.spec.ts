/**
 * Negotiation — price suggestion and margin verdicts, with numbers worked out
 * by hand. Pins the verdict thresholds, the percentile interpolation, the
 * optimal-price adjustment for a trend, the trend threshold, the radius of
 * similar routes and the estimate without history. The simulation without a
 * distance still assumes 500 km — a known issue (docs/known-issues.md); the
 * last test pins today's number, not a wanted behaviour.
 */
import { NegotiationService, marginVerdict } from '../../src/negotiation/negotiation.service';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const OFFER = { id: 'o-1', currency: 'PLN', pickupCountry: 'PL', deliveryCountry: 'DE' };

function suggestion(rows: { price: number; distanceKm?: number | null; createdAt?: Date }[], distanceKm: number | null = null) {
  const prisma: any = {
    offer: {
      findMany: jest.fn(async () => rows.map((r) => ({ price: r.price, currency: 'PLN', distanceKm: r.distanceKm ?? null, pricePerKm: null, createdAt: r.createdAt ?? daysAgo(5) }))),
    },
  };
  return (new NegotiationService(prisma) as any).getPriceSuggestion(OFFER, distanceKm, 'comp-1');
}

describe('marginVerdict — boundaries', () => {
  it.each([
    [20, 'excellent'], [19.99, 'good'],
    [12, 'good'], [11.99, 'acceptable'],
    [8, 'acceptable'], [7.99, 'low'],
    [0, 'low'], [-0.01, 'loss'],
  ])('%s %% → %s', (pct, verdict) => {
    expect(marginVerdict(pct).verdict).toBe(verdict);
  });
});

describe('price suggestion from the history', () => {
  it('percentiles interpolate: 100, 200, 300, 400 → p25 175, median 250, p75 325', async () => {
    const s = await suggestion([{ price: 100 }, { price: 200 }, { price: 300 }, { price: 400 }]);
    expect([s.minPrice, s.maxPrice, s.avgPrice, s.percentiles, s.medianPrice, s.historicalCount])
      .toEqual([100, 400, 250, { p25: 175, p50: 250, p75: 325 }, 250, 4]);
  });

  const trend = (recent: number) => [
    ...[1, 2, 3].map(() => ({ price: recent, createdAt: daysAgo(5) })),
    ...[1, 2, 3].map(() => ({ price: 1000, createdAt: daysAgo(60) })),
  ];

  it('rising (+4 %): the optimal price is the median × 1.03', async () => {
    const s = await suggestion(trend(1040));
    // median of 1000 ×3, 1040 ×3 = 1020; × 1.03 = 1050.6
    expect([s.marketTrend, s.trendPercentChange, s.optimalPrice]).toEqual(['rising', 4, 1051]);
  });

  it('exactly +3 % is still stable: the optimal price is the median', async () => {
    const s = await suggestion(trend(1030));
    expect([s.marketTrend, s.trendPercentChange, s.optimalPrice]).toEqual(['stable', 3, 1015]);
  });

  it('falling (−4 %): the median × 0.97', async () => {
    const s = await suggestion(trend(960));
    // median 980 × 0.97 = 950.6
    expect([s.marketTrend, s.trendPercentChange, s.optimalPrice]).toEqual(['falling', -4, 951]);
  });

  it('similar routes: within 100 km of the distance (or without a distance) count, 101 km off does not', async () => {
    const s = await suggestion([{ price: 1000, distanceKm: 600 }, { price: 5000, distanceKm: 601 }, { price: 2000, distanceKm: null }], 500);
    expect([s.historicalCount, s.maxPrice]).toEqual([2, 2000]);
  });

  it('no history: an estimate from the distance at 4.95 PLN/km (min × 0.85, max × 1.2, p25 × 0.9, p75 × 1.1)', async () => {
    const s = await suggestion([], 1000);
    expect([s.avgPrice, s.minPrice, s.maxPrice, s.percentiles.p25, s.percentiles.p75, s.historicalCount])
      .toEqual([4950, 4950 * 0.85, 4950 * 1.2, 4950 * 0.9, 4950 * 1.1, 0]);
  });
});

describe('simulation with an unknown distance', () => {
  // A reversed characterisation test: before, the costs were counted on an
  // assumed 500 km (other 0.5 PLN/km → 250 PLN) and the simulation was "available".
  it('no distance and no coordinates → no cost, no scenarios, OFFER_COST_NO_DISTANCE (not an assumed 500 km)', async () => {
    const offer = { ...OFFER, companyId: 'comp-1', price: 3000, distanceKm: null, pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null, tollCostEstimate: 100 };
    const prisma: any = {
      offer: { findFirst: jest.fn(async () => offer), findMany: jest.fn(async () => []) },
      company: { findUnique: jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' })) },
      routeCalculation: { findFirst: jest.fn(async () => null) },
    };
    const r = await new NegotiationService(prisma).simulateNegotiation('o-1', 3000, 'comp-1');
    expect([r.available, r.scenarios, r.estimatedCosts.totalPLN, r.unavailable.code]).toEqual([false, [], null, { code: 'OFFER_COST_NO_DISTANCE' }]);
  });
});

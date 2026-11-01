/**
 * Route planner and the toll provider (src/tolls).
 *
 * Without a provider the planner computes no toll: amounts are null with
 * TOLL_PROVIDER_NOT_CONFIGURED, the cost is the company cost per km × km
 * without tolls (OFFER_COST_WITHOUT_TOLLS) and the cost and margin are marked
 * incomplete.
 * With one, its quote is the toll. A provider failure is a 502 with the
 * reason — never a silent fallback.
 */
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const ROUTE = {
  distance: 1_320_000,
  duration: 50_000,
  polyline: '52.4,16.9;52.5,13.4;48.9,2.4',
  sections: [],
  countries: [
    { countryCode: 'PL', distanceKm: 160 },
    { countryCode: 'DE', distanceKm: 760 },
    { countryCode: 'FR', distanceKm: 400 },
  ],
};
const DTO: any = {
  origin: { lat: 52.4064, lng: 16.9252, address: 'Poznań' },
  waypoints: [{ lat: 52.52, lng: 13.405 }],
  destination: { lat: 48.8566, lng: 2.3522, address: 'Paris' },
  vehicle: { grossWeight: 40000, height: 4, width: 2.55, length: 16.5, axleCount: 5, euroClass: 'Euro5', hasAdr: false },
  freightRate: 3000,
  currency: 'EUR',
};

/** The company cost per km 4.20 PLN — the route cost = rate × km + toll. */
function planner(provider: any) {
  const adapter: any = { calculateRoute: jest.fn().mockResolvedValue([ROUTE]) };
  const prisma: any = { company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) } };
  const svc = new RoutePlannerService(adapter, { get: jest.fn(), set: jest.fn() } as any, prisma, provider);
  return { calculateRoute: (dto: any) => svc.calculateRoute(dto, 'c') };
}

describe('no provider registered', () => {
  it('toll is null with TOLL_PROVIDER_NOT_CONFIGURED; cost = 1320 km × 4.20 PLN without tolls; cost and margin incomplete', async () => {
    const r: any = await planner(null).calculateRoute(DTO);
    const c = r.routes[0].costs;
    expect([c.tolls.source, c.tolls.totalEUR, c.tolls.totalPLN, c.tolls.breakdown]).toEqual([null, null, null, []]);
    expect(c.messages.map((m: any) => m.code)).toEqual(expect.arrayContaining(['TOLL_PROVIDER_NOT_CONFIGURED', 'OFFER_COST_WITHOUT_TOLLS']));
    expect([c.perKm.amountPLN, c.totalCostPLN]).toEqual([5544, 5544]);
    expect(c.complete).toBe(false);
    expect(r.routes[0].margin.complete).toBe(false);
    expect(r.recommendation.reason).toMatch(/Koszt bez myta/);
  });
});

describe('with a provider', () => {
  it('sends the route and the vehicle: points in order, km per country, axle class, emission class, weight', async () => {
    const provider = new FixedRateTollProvider();
    await planner(provider).calculateRoute(DTO);
    expect(provider.calls).toEqual([{
      route: {
        points: [{ lat: 52.4064, lng: 16.9252 }, { lat: 52.52, lng: 13.405 }, { lat: 48.8566, lng: 2.3522 }],
        polyline: ROUTE.polyline,
        distanceKm: 1320,
        countries: ROUTE.countries,
      },
      vehicle: { axleClass: '5+', emissionClass: 'EURO_V', grossWeightTonnes: 40 },
    }]);
  });

  it('counts its quote: per country in EUR through fx, total, complete cost and margin', async () => {
    // Fake: PL 160 × 0.40 PLN = 64 PLN = 14.72 EUR; DE 760 × 0.20 = 152 EUR; FR 400 × 0.25 = 100 EUR.
    const r: any = await planner(new FixedRateTollProvider()).calculateRoute(DTO);
    const c = r.routes[0].costs;
    expect(c.tolls.breakdown.map((b: any) => [b.countryCode, b.amount, b.currency, b.costEUR, b.distanceKm])).toEqual([
      ['PL', 64, 'PLN', 14.72, 160], ['DE', 152, 'EUR', 152, 760], ['FR', 100, 'EUR', 100, 400],
    ]);
    expect([c.tolls.source, c.tolls.totalEUR, c.complete]).toEqual(['fake-fixed-rate', 266.72, true]);
    // 5544 PLN × 0.23 = 1275.12 EUR + 266.72 EUR
    expect([c.perKm.amountEUR, c.totalCostEUR]).toEqual([1275.12, 1541.84]);
    expect(r.routes[0].margin).toMatchObject({ complete: true, totalCostInCurrency: c.totalCostEUR });
  });

  it('an amount in a currency without a rate: left out with the reason, cost incomplete', async () => {
    const provider = new FixedRateTollProvider({ rates: { DE: { perKm: 0.2, currency: 'EUR' }, FR: { perKm: 1, currency: 'XYZ' } } });
    const c = (await planner(provider).calculateRoute(DTO) as any).routes[0].costs;
    expect(c.tolls.unresolved).toEqual([{ countryCode: 'FR', distanceKm: 400, reason: 'currency_rate_missing' }]);
    expect(c.complete).toBe(false);
    expect(c.messages.map((m: any) => m.code)).toContain('CURRENCY_CONVERSION_UNAVAILABLE');
  });

  it('provider failure → 502 TOLL_PROVIDER_UNAVAILABLE with the reason; an unexpected error → reason unexpected_error', async () => {
    const fail = (p: any) => planner(p).calculateRoute(DTO).catch((e: any) => [e.getStatus(), e.getResponse()]);
    expect(await fail(new FixedRateTollProvider({ failWith: 'quota_exceeded' }))).toEqual([502, {
      statusCode: 502, code: 'TOLL_PROVIDER_UNAVAILABLE', params: { reason: 'quota_exceeded' }, message: 'TOLL_PROVIDER_UNAVAILABLE',
    }]);
    const broken = { quote: async () => { throw new TypeError('boom'); } };
    expect((await fail(broken))[1]).toMatchObject({ params: { reason: 'unexpected_error' } });
  });
});

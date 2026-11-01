/**
 * A fallback route never reaches an offer's cost.
 *
 * Before: when geocoding or OSRM failed, `RouteCalculatorService` computed a
 * route from the hub table, and without hubs a flat 500 km; the adapter lost
 * `source: 'fallback'`; the planner computed cost and margin on it and, with a
 * complete toll quote, SAVED it with the offer.
 * Now:
 *  - no hub distance — no route (not 500 km); the planner → 503
 *    `ROUTE_UNAVAILABLE`, nothing saved;
 *  - a hub estimate stays for viewing: the adapter marks it `estimated`, the
 *    planner adds `ROUTE_ESTIMATED` to the cost codes and does NOT save it with
 *    the offer (the offer margin unchanged);
 *  - an adapter error — no route (not a 0 km route).
 */
import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { RouteCalculatorService } from '../../src/route-planner/osrm-calculator.service';
import { OsrmAdapterService } from '../../src/route-planner/osrm-adapter.service';
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const MADRID = { lat: 40.4168, lon: -3.7038 };
const POZNAN = { lat: 52.4064, lon: 16.9252 };
const BERLIN = { lat: 52.52, lon: 13.405 };

describe('RouteCalculatorService fallback', () => {
  it('geocoding failed and no hubs → no route at all (not a flat 500 km)', async () => {
    const svc: any = new RouteCalculatorService();
    svc.geocode = async () => null;
    expect(await svc.calculateRoute('Nowhere', 'Nothing')).toBeNull();
  });

  it('OSRM failed, places known → the hub estimate (Warsaw–Madrid, hub table), marked as fallback', async () => {
    const svc: any = new RouteCalculatorService();
    svc.geocode = async (p: string) => (p.startsWith('War') ? WARSAW : MADRID);
    svc.fetchOsrmRoute = async () => null;
    const r = await svc.calculateRoute('Warszawa', 'Madrid');
    expect([r.source, r.distanceKm]).toEqual(['fallback', 2977]);
  });

  it('OSRM failed and both ends at the same hub (Poznań, Berlin → BER) → no route, not 0 km', async () => {
    const svc: any = new RouteCalculatorService();
    svc.geocode = async (p: string) => (p.startsWith('Pozna') ? POZNAN : BERLIN);
    svc.fetchOsrmRoute = async () => null;
    expect(await svc.calculateRoute('Poznań', 'Berlin')).toBeNull();
  });
});

const VEHICLE = { grossWeight: 40000, height: 4, width: 2.55, length: 16.5, hasAdr: false };
const params = { origin: { lat: 52.4, lng: 16.9 }, destination: { lat: 52.5, lng: 13.4 }, vehicle: VEHICLE };
const osrmResult = (source: string) => ({
  distanceKm: 270, durationMinutes: 200, countries: ['PL', 'DE'],
  countryDistances: [{ code: 'PL', distanceKm: 135 }, { code: 'DE', distanceKm: 135 }],
  tollCosts: [{ country: 'PL', system: 'e-TOLL', distanceKm: 135, ratePerKm: 0.2, costEur: 27 }],
  crossings: [], vignetteRequirements: [], totalTollCostEur: 27, totalCrossingCostEur: 0,
  geometry: { type: 'LineString', coordinates: [[16.9, 52.4], [13.4, 52.5]] }, source,
});

describe('OsrmAdapterService', () => {
  it.each([
    ['osrm', false],
    ['cache', false],
    ['fallback', true],
  ])('source %s → estimated %s', async (source, estimated) => {
    const adapter = new OsrmAdapterService({ calculateRoute: async () => osrmResult(source) } as any);
    const [route] = await adapter.calculateRoute(params as any);
    expect(route.estimated).toBe(estimated);
  });

  it.each([
    ['no route (null)', async () => null],
    ['an error', async () => { throw new Error('boom'); }],
  ])('%s → no routes (not a 0 km route)', async (_n, calc) => {
    const adapter = new OsrmAdapterService({ calculateRoute: calc } as any);
    expect(await adapter.calculateRoute(params as any)).toEqual([]);
  });
});

describe('RoutePlannerService with an estimated or missing route', () => {
  function planner(routes: unknown[]) {
    const prisma: any = {
      company: { findUnique: jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' })) },
      offer: { findFirst: jest.fn(async () => ({ id: 'o1', price: 2000, currency: 'EUR', distanceKm: 280, tollCostEstimate: null })), update: jest.fn() },
      routeCalculation: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    };
    const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
    // A toll provider is registered — otherwise the copy never saves a route anyway.
    const svc = new RoutePlannerService({ calculateRoute: async () => routes } as any, cache, prisma, new FixedRateTollProvider());
    return { svc, prisma };
  }
  const dto: any = { origin: params.origin, destination: params.destination, vehicle: VEHICLE, offerId: 'o1', currency: 'EUR', freightRate: 2000 };
  const estimatedRoute = {
    distance: 270000, duration: 12000, polyline: '52.4,16.9;52.5,13.4', estimated: true, sections: [],
    countries: [{ countryCode: 'PL', distanceKm: 135 }, { countryCode: 'DE', distanceKm: 135 }],
  };

  it('an estimated route: shown with ROUTE_ESTIMATED, NOT saved with the offer, the offer margin untouched', async () => {
    const { svc, prisma } = planner([estimatedRoute]);
    const res: any = await svc.calculateRoute(dto, 'c1');
    expect(res.routes[0].costs.messages.map((m: any) => m.code)).toContain('ROUTE_ESTIMATED');
    expect([prisma.routeCalculation.create.mock.calls.length, prisma.offer.update.mock.calls.length]).toEqual([0, 0]);
  });

  it('a real route: saved with the offer (control)', async () => {
    const { svc, prisma } = planner([{ ...estimatedRoute, estimated: false }]);
    const res: any = await svc.calculateRoute(dto, 'c1');
    expect(res.routes[0].costs.messages.map((m: any) => m.code)).not.toContain('ROUTE_ESTIMATED');
    expect(prisma.routeCalculation.create).toHaveBeenCalledTimes(1);
  });

  it('no route → 503 ROUTE_UNAVAILABLE, nothing saved', async () => {
    const { svc, prisma } = planner([]);
    const err = await svc.calculateRoute(dto, 'c1').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse()).toMatchObject({ statusCode: 503, code: 'ROUTE_UNAVAILABLE' });
    expect(prisma.routeCalculation.create).not.toHaveBeenCalled();
  });

  it('both codes are in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toEqual(expect.arrayContaining(['ROUTE_ESTIMATED', 'ROUTE_UNAVAILABLE']));
  });
});

/**
 * RouteCalculatorService — route cache and the route result.
 *
 * The result has distance, duration and km per country; no toll amounts
 * (they come from the TollProvider, src/tolls). No network: geocoding, OSRM
 * and country detection are replaced.
 */
import { RouteCalculatorService, routeCacheKey, stableStringify } from '../../src/route-planner/osrm-calculator.service';

function makeService(country: 'DE' | 'CH') {
  const real = new RouteCalculatorService();
  const svc = real as any;
  svc.geocode = jest.fn().mockResolvedValue({ lat: 50, lon: 10 });
  svc.fetchOsrmRoute = jest.fn().mockResolvedValue({
    distance: 500_000,
    duration: 18_000,
    geometry: { type: 'LineString', coordinates: [[10, 50], [11, 50]] },
  });
  svc.detectCountries = jest.fn().mockResolvedValue([{ code: country, distanceKm: 500 }]);
  return Object.assign(real, { osrmCalls: () => (svc.fetchOsrmRoute as jest.Mock).mock.calls.length });
}

describe('OSRM route cache', () => {
  it('the same route with the same waypoints is served from the cache — one OSRM call', async () => {
    const svc = makeService('DE');
    await svc.calculateRoute('Berlin', 'Hamburg');
    const again = await svc.calculateRoute('Berlin', 'Hamburg');
    expect(svc.osrmCalls()).toBe(1);
    expect(again.source).toBe('cache');
  });

  it('different waypoints → a separate calculation', async () => {
    const svc = makeService('DE');
    await svc.calculateRoute('Berlin', 'Hamburg');
    await svc.calculateRoute('Berlin', 'Hamburg', { waypoints: [{ lat: 52.4, lon: 10.8 }] });
    expect(svc.osrmCalls()).toBe(2);
  });

  it('the result carries km per country — the input a toll provider needs — and no toll amounts', async () => {
    const r: any = await makeService('CH').calculateRoute('Basel', 'Chiasso');
    expect(r.countryDistances).toEqual([{ code: 'CH', distanceKm: 500 }]);
    expect(r).not.toHaveProperty('tollCosts');
    expect(r).not.toHaveProperty('totalTollCostEur');
  });
});

describe('routeCacheKey', () => {
  it('the same options in a different key order give the same key', () => {
    expect(routeCacheKey('Berlin', 'Hamburg', { axles: '3', emissionClass: 'EURO_VI' }))
      .toBe(routeCacheKey(' berlin ', 'HAMBURG', { emissionClass: 'EURO_VI', axles: '3' }));
  });

  it('an undefined option is the same as a missing one', () => {
    expect(routeCacheKey('A', 'B', { axles: '3', grossWeightTonnes: undefined }))
      .toBe(routeCacheKey('A', 'B', { axles: '3' }));
  });

  it('waypoints are part of the key', () => {
    expect(routeCacheKey('A', 'B', { waypoints: [{ lat: 1, lon: 2 }] }))
      .not.toBe(routeCacheKey('A', 'B', { waypoints: [{ lat: 1, lon: 3 }] }));
  });

  it('a vehicle parameter nobody listed yet still changes the key', () => {
    // Future-proofing: a new field in options needs no change to the key function.
    expect(routeCacheKey('A', 'B', { axles: '3', someFutureVehicleParam: 1 } as object))
      .not.toBe(routeCacheKey('A', 'B', { axles: '3', someFutureVehicleParam: 2 } as object));
  });

  it('stableStringify sorts nested keys and keeps arrays in order', () => {
    expect(stableStringify({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});

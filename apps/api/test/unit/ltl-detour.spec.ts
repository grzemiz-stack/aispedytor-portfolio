/**
 * LtlMatchingService — detour distance for part loads.
 *
 * Characterization test: pins the numbers the code produces, so any change to
 * the formula, the road factor or the coordinate source shows up in this
 * file's diff, not only in the forwarder's result.
 *
 * Trip Poznań → Hamburg. City-centre coordinates are hard-coded — the numbers
 * depend on them (Nominatim coordinates give a few km more or less).
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

const POZNAN = { lat: 52.4064, lng: 16.9252 };
const BERLIN = { lat: 52.52, lng: 13.405 };
const HAMBURG = { lat: 53.5511, lng: 9.9937 };

const vehicle = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'PO 12345',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  maxPalletCount: 33,
  grossVehicleWeightKg: 40000,
  curbWeightKg: 15000,
};

const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  externalId: null,
  source: 'manual',
  pickupCity: 'Berlin',
  pickupCountry: 'DE',
  deliveryCity: 'Poznań',
  deliveryCountry: 'PL',
  pickupLat: BERLIN.lat,
  pickupLng: BERLIN.lng,
  deliveryLat: POZNAN.lat,
  deliveryLng: POZNAN.lng,
  weightKg: 1000,
  lengthM: 1.2,
  palletCount: 1,
  price: 900,
  currency: 'EUR',
  pricePerKm: null,
  cargoType: 'Palety',
  contractor: null,
  ...over,
});

/**
 * "Now" injected: the loadings of these tests are in January 2030 — in the
 * future relative to NOW, not to the real day (an offer whose loading day has
 * passed is dead and leaves the list).
 */
const NOW = new Date('2030-01-01T10:00:00Z');

function makeService(offers: any[]) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  service.now = () => NOW;
  // Call order: route start, then route end. No network.
  (service as any).geocode = jest
    .fn()
    .mockResolvedValueOnce(POZNAN)
    .mockResolvedValueOnce(HAMBURG);
  return service;
}

/** Wide limits, so the detour filter cuts nothing. */
const search = (over: Record<string, any> = {}) =>
  ({
    vehicleId: 'veh-1',
    routeFrom: 'Poznań',
    routeTo: 'Hamburg',
    currentLoadMeters: 0,
    currentLoadWeight: 0,
    maxDetourKm: 1000,
    ...over,
  }) as any;

async function onlyMatch(offers: any[], over: Record<string, any> = {}) {
  const res = await makeService(offers).findMatchingOffers('comp-1', search(over));
  expect(res.matches).toHaveLength(1);
  return res.matches[0];
}

describe('LTL detour — offer with coordinates', () => {
  it('return load Berlin → Poznań on Poznań → Hamburg: from→pickup + pickup→delivery + delivery→to − from→to, × 1.25', async () => {
    const m = await onlyMatch([offer('ret')]);
    expect(m.detourKm).toBe(597);
    expect(m.detourPercent).toBe(99.3);
  });

  it('load on the way Berlin → Hamburg', async () => {
    const m = await onlyMatch([
      offer('way', { deliveryCity: 'Hamburg', deliveryCountry: 'DE', deliveryLat: HAMBURG.lat, deliveryLng: HAMBURG.lng }),
    ]);
    expect(m.detourKm).toBe(16);
    expect(m.detourPercent).toBe(2.7);
  });

  it('an offer with coordinates carries no card-level warning', async () => {
    const m = await onlyMatch([offer('ret')]);
    expect(m.warnings).toEqual([]);
  });
});

describe('LTL detour — offer without coordinates is not ranked (awaiting location)', () => {
  const noCoords = { pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null };

  it('no coordinates → not in matches, in awaitingLocation with OFFER_AWAITING_LOCATION', async () => {
    // Not a guessed detour (50 km in the route's country, 150 km elsewhere) and a ranking place.
    const res = await makeService([offer('n1', { ...noCoords, pickupCountry: 'PL' })])
      .findMatchingOffers('comp-1', search({ routeFrom: 'Poznań, PL' }));
    expect(res.matches).toEqual([]);
    expect(res.awaitingLocation).toEqual([
      expect.objectContaining({ offerId: 'n1', pickupCity: 'Berlin', deliveryCity: 'Poznań', reasons: [{ code: 'OFFER_AWAITING_LOCATION' }] }),
    ]);
  });

  it.each([
    ['pickup latitude', { pickupLat: null }],
    ['pickup longitude', { pickupLng: null }],
    ['delivery latitude', { deliveryLat: null }],
    ['delivery longitude', { deliveryLng: null }],
  ])('one missing value (%s) is enough to wait — no half-guessed detour', async (_label, over) => {
    const res = await makeService([offer('half', over)]).findMatchingOffers('comp-1', search());
    expect(res.matches).toEqual([]);
    expect(res.awaitingLocation.map(o => o.offerId)).toEqual(['half']);
  });

  it('coordinate equal to 0 is a coordinate, not a missing value', async () => {
    const res = await makeService([offer('z', { deliveryLng: 0 })]).findMatchingOffers('comp-1', search({ maxDetourKm: 5000 }));
    expect(res.awaitingLocation).toEqual([]);
    expect(res.matches.map(m => m.detourKm)).toEqual([1682]);
    expect(res.matches[0].warnings).toEqual([]);
  });

  it('limit 10, the rest counted as hidden; soonest pickup first, then id', async () => {
    const day = (n: number) => new Date(Date.UTC(2030, 0, n, 8));
    const waiting = Array.from({ length: 13 }, (_, i) =>
      offer(`w-${String(i).padStart(2, '0')}`, { ...noCoords, pickupDate: day(20 - i) }));
    const res = await makeService([offer('ranked'), ...waiting]).findMatchingOffers('comp-1', search());
    expect(res.matches.map(m => m.offerId)).toEqual(['ranked']);
    // w-12 has the earliest pickup (8.01), w-00 the latest (20.01) — it and the two before it are hidden.
    expect(res.awaitingLocation.map(o => o.offerId)).toEqual(
      ['w-12', 'w-11', 'w-10', 'w-09', 'w-08', 'w-07', 'w-06', 'w-05', 'w-04', 'w-03'],
    );
    expect(res.hiddenAwaitingLocation).toBe(3);
  });

  it('same pickup day → by id; exactly 10 → nothing hidden', async () => {
    const same = new Date(Date.UTC(2030, 0, 10, 8));
    const ten = ['j', 'c', 'a', 'h', 'b', 'i', 'd', 'g', 'e', 'f'].map(id => offer(id, { ...noCoords, pickupDate: same }));
    const res = await makeService(ten).findMatchingOffers('comp-1', search());
    expect(res.awaitingLocation.map(o => o.offerId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(res.hiddenAwaitingLocation).toBe(0);
  });

  it('an incompatible offer without coordinates is reported as incompatible (the stronger reason), not awaiting', async () => {
    const res = await makeService([offer('adr', { ...noCoords, isAdr: true, adrClass: '3' })]).findMatchingOffers('comp-1', search());
    expect(res.incompatible.map(o => o.offerId)).toEqual(['adr']);
    expect(res.awaitingLocation).toEqual([]);
  });
});

describe('LTL route endpoints', () => {
  it('are geocoded through GeocodingService (cache + 1 req/s), never straight to Nominatim', async () => {
    const prisma: any = {
      vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
      offer: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const geocoding: any = { geocode: jest.fn().mockResolvedValueOnce(POZNAN).mockResolvedValueOnce(HAMBURG) };
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    await new LtlMatchingService(prisma, geocoding).findMatchingOffers('comp-1', search());
    expect(geocoding.geocode).toHaveBeenCalledWith('Poznań');
    expect(geocoding.geocode).toHaveBeenCalledWith('Hamburg');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('LTL result notices', () => {
  const noCoords = { pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null };

  it('"approximate route" is ONE notice for the whole result, not repeated per offer', async () => {
    const res = await makeService([offer('a'), offer('b'), offer('c')]).findMatchingOffers('comp-1', search());
    expect(res.matches).toHaveLength(3);
    // Plus once: no toll provider registered (src/tolls) — detour toll not counted.
    expect(res.notices).toEqual([
      { code: 'DETOUR_APPROXIMATE', params: { roadFactor: 1.25 } },
      { code: 'TOLL_PROVIDER_NOT_CONFIGURED' },
    ]);
    for (const m of res.matches) {
      expect(m.warnings.map(w => w.code)).not.toContain('DETOUR_APPROXIMATE');
    }
  });

  it('an offer awaiting location leaves no card and no warning on the other cards', async () => {
    const res = await makeService([offer('a'), offer('c', noCoords)]).findMatchingOffers('comp-1', search());
    expect(res.matches.map(m => [m.offerId, m.warnings])).toEqual([['a', []]]);
    expect(res.awaitingLocation.map(o => o.offerId)).toEqual(['c']);
  });

  it('route not geocoded → 422 ROUTE_GEOCODING_FAILED naming the place, not an empty list', async () => {
    // Not { matches: [], notices: [] } — the screen would say "no matching offers".
    const service = makeService([offer('a')]);
    (service as any).geocode = jest.fn().mockImplementation(async (q: string) => (q === 'Poznań' ? POZNAN : null));
    const err = await service.findMatchingOffers('comp-1', search({ routeTo: 'Hamburgg' })).catch(e => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'ROUTE_GEOCODING_FAILED', params: { places: 'Hamburgg' } });
  });

  it('both ends failing → both places in the message', async () => {
    const service = makeService([offer('a')]);
    (service as any).geocode = jest.fn().mockResolvedValue(null);
    const err = await service.findMatchingOffers('comp-1', search({ routeFrom: 'Pznan', routeTo: 'Hmbrg' })).catch(e => e);
    expect(err.getResponse()).toMatchObject({ code: 'ROUTE_GEOCODING_FAILED', params: { places: 'Pznan · Hmbrg' } });
  });
});

describe('LTL detour limit — one limit, the km slider of the screen', () => {
  const SZCZECIN = { lat: 53.4285, lng: 14.5528 };
  /** Berlin → Szczecin on a Poznań → Hamburg trip: 233 km detour (ltl-ranking.spec.ts). */
  const toSzczecin = () => offer('szczecin', { deliveryCity: 'Szczecin', deliveryLat: SZCZECIN.lat, deliveryLng: SZCZECIN.lng });
  /** Pickup at the start of the route, delivery at the end — a detour of exactly 0. */
  const onRoute = () => offer('on-route', {
    pickupCity: 'Poznań', pickupCountry: 'PL', pickupLat: POZNAN.lat, pickupLng: POZNAN.lng,
    deliveryCity: 'Hamburg', deliveryCountry: 'DE', deliveryLat: HAMBURG.lat, deliveryLng: HAMBURG.lng,
  });

  /**
   * The body EXACTLY as the screen sends it (ltl-matching/page.tsx,
   * handleSearch) — no maxDetourPercent, the screen has none.
   */
  const screenRequest = (maxDetourKm: number) =>
    ({
      vehicleId: 'veh-1',
      currentLoadMeters: 6.7,
      currentLoadWeight: 0,
      routeFrom: 'Poznań',
      routeTo: 'Hamburg',
      maxDetourKm,
    }) as any;

  it('slider 300 km, detour 233 km → matched (a hidden 15 % of the 601 km route would cut at 90)', async () => {
    const res = await makeService([toSzczecin()]).findMatchingOffers('comp-1', screenRequest(300));
    expect(res.matches.map(m => [m.offerId, m.detourKm])).toEqual([['szczecin', 233]]);
  });

  it('the slider cuts: 233 km detour with a 200 km limit → not matched', async () => {
    const res = await makeService([toSzczecin()]).findMatchingOffers('comp-1', screenRequest(200));
    expect(res.matches).toEqual([]);
  });

  it('a detour exactly at the limit is matched (≤, not <): 0 km with a 0 km limit', async () => {
    const res = await makeService([onRoute()]).findMatchingOffers('comp-1', screenRequest(0));
    expect(res.matches.map(m => [m.offerId, m.detourKm])).toEqual([['on-route', 0]]);
  });

  it('the screen body with an offer without coordinates: no card, no amount, in awaitingLocation', async () => {
    // Not a guessed 150 km for Berlin → Poznań without coordinates, ranked under a 200 km slider.
    const noCoords = offer('no-coords', { pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null });
    const res = await makeService([noCoords, onRoute()]).findMatchingOffers('comp-1', screenRequest(200));
    expect(res.matches.map(m => m.offerId)).toEqual(['on-route']);
    expect(res.awaitingLocation).toEqual([{
      offerId: 'no-coords', pickupCity: 'Berlin', pickupCountry: 'DE', deliveryCity: 'Poznań', deliveryCountry: 'PL',
      pickupDate: undefined, reasons: [{ code: 'OFFER_AWAITING_LOCATION' }],
    }]);
  });

  it('no limit in the request → 100 km, the screen default', async () => {
    const { maxDetourKm, ...noLimit } = screenRequest(0);
    const res = await makeService([toSzczecin(), onRoute()]).findMatchingOffers('comp-1', noLimit);
    expect(res.matches.map(m => m.offerId)).toEqual(['on-route']);
  });

});

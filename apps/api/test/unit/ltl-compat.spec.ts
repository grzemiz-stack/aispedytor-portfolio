/**
 * LtlMatchingService — offer ↔ vehicle compatibility.
 *
 * Characterization test: pins which offers make it into the result. Any
 * change to the filters (pickup date, offer age, ADR, reefer) must show up in
 * this file's diff.
 *
 * Vehicle: curtain-sider without ADR. Trip Poznań → Berlin, offers on the way.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

const POZNAN = { lat: 52.4064, lng: 16.9252 };
const BERLIN = { lat: 52.52, lng: 13.405 };
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fixed clock: 5.10.2026, 12:00 UTC (14:00 in Warsaw). */
const NOW = new Date('2026-10-05T12:00:00Z');

const vehicle = (over: Record<string, any> = {}) => ({
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'PO 12345',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  hasAdr: false,
  adrClasses: [],
  availableFrom: null,
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  maxPalletCount: 33,
  grossVehicleWeightKg: 40000,
  curbWeightKg: 15000,
  ...over,
});

const offer = (id: string, over: Record<string, any> = {}) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  externalId: null,
  source: 'manual',
  pickupCity: 'Poznań',
  pickupCountry: 'PL',
  deliveryCity: 'Berlin',
  deliveryCountry: 'DE',
  pickupLat: POZNAN.lat,
  pickupLng: POZNAN.lng,
  deliveryLat: BERLIN.lat,
  deliveryLng: BERLIN.lng,
  pickupDate: new Date('2026-10-06T00:00:00Z'),
  expiresAt: null,
  createdAt: new Date(NOW.getTime() - DAY_MS),
  isAdr: false,
  adrClass: null,
  isFrigo: false,
  temperatureMin: null,
  temperatureMax: null,
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

function makeService(offers: any[], veh = vehicle(), companyCountry = 'PL') {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(veh) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue({ country: companyCountry }) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  service.now = () => NOW;
  (service as any).geocode = jest.fn().mockResolvedValueOnce(POZNAN).mockResolvedValueOnce(BERLIN);
  return { service, prisma };
}

const search = {
  vehicleId: 'veh-1',
  routeFrom: 'Poznań',
  routeTo: 'Berlin',
  currentLoadMeters: 0,
  currentLoadWeight: 0,
  maxDetourKm: 500,
} as any;

async function run(offers: any[], veh = vehicle()) {
  const { service } = makeService(offers, veh);
  return service.findMatchingOffers('comp-1', search);
}

async function matchedIds(offers: any[], veh = vehicle()) {
  return (await run(offers, veh)).matches.map(m => m.offerId);
}

async function incompatibleReasons(offers: any[], veh = vehicle()) {
  return (await run(offers, veh)).incompatible.map(i => [i.offerId, i.reasons.map(r => r.code)]);
}

describe('LTL compatibility — dead offers are dropped silently', () => {
  it('the query drops dead offers before the 200 limit, with a two-day margin on the pickup date', async () => {
    const { service, prisma } = makeService([]);
    await service.findMatchingOffers('comp-1', search);
    expect(prisma.offer.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'comp-1',
      status: 'NEW',
      pickupDate: { gte: new Date('2026-10-03T12:00:00Z') },
      createdAt: { gte: new Date('2026-09-28T12:00:00Z') },
      OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
    });
  });

  it('an offer with a pickup date in the past is neither matched nor listed as incompatible', async () => {
    const res = await run([offer('past', { pickupDate: new Date('2026-10-04T00:00:00Z') })]);
    expect(res.matches).toEqual([]);
    expect(res.incompatible).toEqual([]);
  });

  it('an offer for today (UTC midnight from import) is matched', async () => {
    expect(await matchedIds([offer('today', { pickupDate: new Date('2026-10-05T00:00:00Z') })])).toEqual(['today']);
  });

  it('an offer past its expiresAt is dropped', async () => {
    expect(await matchedIds([offer('exp', { expiresAt: new Date(NOW.getTime() - 60_000) })])).toEqual([]);
  });

  it('a GB offer for "today" is judged in Europe/London', async () => {
    // 22:30 UTC: already 6.10 in Warsaw, still 5.10 in London.
    const { service } = makeService([
      offer('gb', { pickupCountry: 'GB', pickupDate: new Date('2026-10-05T00:00:00Z') }),
      offer('pl', { pickupCountry: 'PL', pickupDate: new Date('2026-10-05T00:00:00Z') }),
    ]);
    service.now = () => new Date('2026-10-05T22:30:00Z');
    const res = await service.findMatchingOffers('comp-1', search);
    expect(res.matches.map(m => m.offerId)).toEqual(['gb']);
  });

  // The company is always read (cost per km and currency for the ranking) —
  // once per search, however many offers come from outside the zone map.
  it('the company is read once per search, also when several pickup countries are outside the map', async () => {
    const { service, prisma } = makeService(
      [offer('x', { pickupCountry: 'XX' }), offer('y', { pickupCountry: 'YY' }), offer('a')],
      vehicle(),
      'GB',
    );
    await service.findMatchingOffers('comp-1', search);
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('LTL compatibility — incompatible offers come back with reasons', () => {
  it('an ADR offer on a vehicle without ADR', async () => {
    expect(await incompatibleReasons([offer('adr', { isAdr: true, adrClass: '3' })]))
      .toEqual([['adr', ['OFFER_ADR_VEHICLE_NOT_CERTIFIED']]]);
  });

  it('a temperature-controlled offer on a curtain trailer', async () => {
    expect(await incompatibleReasons([offer('frigo', { isFrigo: true, temperatureMin: -20, temperatureMax: -18 })]))
      .toEqual([['frigo', ['OFFER_REQUIRES_REEFER']]]);
  });

  it('a pickup before the vehicle is available', async () => {
    const veh = vehicle({ availableFrom: new Date('2026-10-10T06:00:00Z') });
    expect(await incompatibleReasons([offer('early')], veh))
      .toEqual([['early', ['OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE']]]);
  });

  it('an incompatible offer is not scored and not counted as unmeasurable', async () => {
    const res = await run([offer('adr', { isAdr: true, adrClass: '3', weightKg: null })]);
    expect(res.matches).toEqual([]);
    expect(res.unmeasurable).toEqual([]);
    expect(res.incompatible[0]).toMatchObject({ offerId: 'adr', pickupCity: 'Poznań', deliveryCity: 'Berlin' });
  });

  it('a reefer trailer stored as a separate record makes the vehicle a reefer', async () => {
    const veh = vehicle({ trailerType: null, trailers: [{ vehicleType: 'TRUCK', trailerType: 'REEFER' }] });
    expect(await matchedIds([offer('frigo', { isFrigo: true })], veh)).toEqual(['frigo']);
  });

  it('a compatible offer carries its compatibility warning on the card', async () => {
    const veh = vehicle({ trailerType: 'REEFER' });
    const res = await run([offer('frigo', { isFrigo: true, temperatureMin: 2, temperatureMax: 6 })], veh);
    expect(res.matches[0].warnings).toContainEqual({
      code: 'OFFER_TEMPERATURE_UNVERIFIED',
      params: { temperatureMin: 2, temperatureMax: 6 },
    });
  });

  it('an offer loading in a country outside the zone map carries the assumed-zone warning', async () => {
    const { service } = makeService([offer('x', { pickupCountry: 'XX' })], vehicle(), 'GB');
    const res = await service.findMatchingOffers('comp-1', search);
    expect(res.matches[0].warnings).toContainEqual({
      code: 'OFFER_PICKUP_TIMEZONE_ASSUMED',
      params: { timeZone: 'Europe/London', pickupCountry: 'XX' },
    });
  });

  it('the result now lists incompatible offers', async () => {
    const res = await run([]);
    expect(Object.keys(res).sort()).toEqual(['awaitingLocation', 'capacity', 'hiddenAwaitingLocation', 'hiddenBlocked', 'hiddenWithoutAmount', 'incompatible', 'matches', 'notices', 'unmeasurable', 'unmeasurableTotal']);
  });
});

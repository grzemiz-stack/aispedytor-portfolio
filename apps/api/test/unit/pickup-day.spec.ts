/**
 * The loading day consistently: matching and negotiation count it in the
 * pickup country's time zone, as LTL does.
 *
 * Before: matching compared documents with the loading day in UTC;
 * "Pilny termin: dzisiaj/jutro" in negotiation came from a difference of hours.
 * Now:
 *  - the loading day = the day in the pickup country's zone (a country outside
 *    the map → the company country, then Warsaw, with
 *    OFFER_PICKUP_TIMEZONE_ASSUMED); an offer without a date — today there;
 *  - the document day = the stored date (a field without a time, midnight
 *    UTC) — its UTC day; a document valid "until X" is valid all of day X;
 *  - dates without a time (00:00Z, import) stay the same day in Europe.
 */
import 'reflect-metadata';
import { dateOnlyDay, pickupDay } from '../../src/common/country-timezone';
import { MatchingService } from '../../src/matching/matching.service';
import { NegotiationService } from '../../src/negotiation/negotiation.service';

describe('the rule', () => {
  it.each(['PL', 'GB', 'IE', 'PT'])('a date without a time (00:00Z) loading in %s stays 10.10 — summer and winter', (country) => {
    expect(pickupDay(new Date('2026-10-10T00:00:00Z'), country, null).day).toBe('2026-10-10');
    expect(pickupDay(new Date('2026-12-10T00:00:00Z'), country, null).day).toBe('2026-12-10');
  });

  it('10.10 22:30Z: in Warsaw already 11.10, in London still 10.10', () => {
    const at = new Date('2030-10-10T22:30:00Z');
    expect([pickupDay(at, 'PL', null).day, pickupDay(at, 'GB', null).day]).toEqual(['2030-10-11', '2030-10-10']);
  });

  it('a country outside the map → the company country, assumed; no company country → Warsaw', () => {
    // 22:30Z: London (summer time, UTC+1) 23:30 on 10.10, Warsaw 00:30 on 11.10.
    const at = new Date('2030-10-10T22:30:00Z');
    expect(pickupDay(at, 'XX', 'GB')).toEqual({ day: '2030-10-10', timeZone: 'Europe/London', assumed: true });
    expect(pickupDay(at, 'XX', null)).toEqual({ day: '2030-10-11', timeZone: 'Europe/Warsaw', assumed: true });
  });

  it('no pickup date → today in that zone', () => {
    expect(pickupDay(null, 'PL', null, new Date('2030-10-10T22:30:00Z')).day).toBe('2030-10-11');
  });

  it('a document date is its stored day (UTC), whatever the time', () => {
    expect([dateOnlyDay(new Date('2030-10-10T00:00:00Z')), dateOnlyDay('2030-10-09T23:59:00Z')]).toEqual(['2030-10-10', '2030-10-09']);
  });
});

// ── Matching ────────────────────────────────────────────────────────────────

const VEHICLE = {
  id: 'v', companyId: 'c', status: 'AVAILABLE', vehicleType: 'TRUCK', trailerType: 'CURTAIN', maxWeightKg: 24000, currentCountry: 'PL',
  brand: null, model: null, plateNumber: 'P', licensePlate: 'P', hasAdr: false, adrClasses: [], trailers: [], availableFrom: null,
  technicalInspectionTo: new Date('2099-01-01'), insuranceTo: new Date('2030-10-10T00:00:00Z'), tachographLegalizationTo: new Date('2099-01-01'),
};
const OFFER = {
  id: 'o', companyId: 'c', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin', weightKg: 1000,
  price: 1000, currency: 'EUR', isAdr: false, adrClass: null, isFrigo: false, temperatureMin: null, temperatureMax: null,
};
function matching(offer: object, company: object | null = null) {
  const offers = [{ ...OFFER, ...offer }];
  const prisma: any = {
    offer: { findFirst: async () => offers[0], findMany: async () => offers },
    vehicle: { findFirst: async () => VEHICLE, findMany: async () => [VEHICLE] },
    company: { findUnique: jest.fn(async () => company) },
  };
  return { svc: new MatchingService(prisma), prisma };
}
const codes = (ms: any[]) => ms.map((m) => m.code);

describe('matching: documents against the loading day in the pickup country', () => {
  // A fake clock: the loading on 10.10.2030 must be in the future relative to NOW,
  // not to the real day — the vehicle → offers list drops offers whose loading day has passed.
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2030-10-01T10:00:00Z')));
  afterAll(() => jest.useRealTimers());

  it('insurance valid until 10.10, loading 10.10 22:30Z in PL (Warsaw: 11.10) → blocked, documents 7/10', async () => {
    const [m] = await matching({ pickupDate: new Date('2030-10-10T22:30:00Z') }).svc.findMatchingVehicles('o', 'c');
    expect([codes(m.blockedBy), m.matchDetails.docsValid]).toEqual([['MATCH_VEHICLE_DOCUMENTS_EXPIRED'], 7]);
  });

  it('the same instant loading in GB (London: still 10.10) → not blocked, documents 10/10', async () => {
    const [m] = await matching({ pickupCountry: 'GB', pickupDate: new Date('2030-10-10T22:30:00Z') }).svc.findMatchingVehicles('o', 'c');
    expect([codes(m.blockedBy), m.matchDetails.docsValid]).toEqual([[], 10]);
  });

  it('a date without a time (10.10 00:00Z) loading in PL → still valid on 10.10', async () => {
    const [m] = await matching({ pickupDate: new Date('2030-10-10T00:00:00Z') }).svc.findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy)).toEqual([]);
  });

  it('the offers of a vehicle get the same rule', async () => {
    const [m] = await matching({ pickupDate: new Date('2030-10-10T22:30:00Z') }).svc.findMatchingOffers('v', 'c');
    expect(codes(m.blockedBy)).toEqual(['MATCH_VEHICLE_DOCUMENTS_EXPIRED']);
  });

  it('a pickup country outside the map → the company country zone, said with OFFER_PICKUP_TIMEZONE_ASSUMED', async () => {
    const { svc, prisma } = matching({ pickupCountry: 'XX', pickupDate: new Date('2030-10-10T22:30:00Z') }, { country: 'GB' });
    const [m] = await svc.findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy)).toEqual([]); // London: still 10.10
    expect(codes(m.warnings)).toContain('OFFER_PICKUP_TIMEZONE_ASSUMED');
    expect(prisma.company.findUnique.mock.calls[0][0].where).toEqual({ id: 'c' });
  });

  it('a known pickup country → the company is not read at all', async () => {
    const { svc, prisma } = matching({ pickupDate: new Date('2030-10-10T00:00:00Z') });
    await svc.findMatchingVehicles('o', 'c');
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
});

// ── Negotiation: "Pilny termin" ────────────────────────────────────────────

describe('negotiation: "Pilny termin — dzisiaj/jutro" by calendar day in the pickup country', () => {
  function urgency(pickupDate: Date, now: string, pickupCountry = 'PL', company: object = {}) {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const offer = {
      id: 'o1', companyId: 'c', pickupCity: 'A', deliveryCity: 'B', pickupCountry, deliveryCountry: 'DE', distanceKm: 800, tollCostEstimate: null,
      contractorId: null, pickupDate, cargoType: 'x', isAdr: false, isFrigo: false, weightKg: 1000, pricePerKm: null, price: 9000, currency: 'PLN',
    };
    const svc = new NegotiationService({
      offer: { findFirst: async () => offer, findMany: async () => [], count: async () => 0, aggregate: async () => ({ _avg: {} }) },
      company: { findUnique: async () => ({ costPerKm: 4.2, costCurrency: 'PLN', ...company }) },
      routeCalculation: { findFirst: async () => null },
      contractor: { findFirst: async () => null },
    } as any);
    (svc as any).getPriceSuggestion = async () => ({ avgPrice: 9000, optimalPrice: 9000, minPrice: 8800, maxPrice: 9200, medianPrice: 9000, confidence: 0, sampleSize: 0, percentiles: { p25: 0, p50: 0, p75: 0 }, trendPercentChange: 0 });
    return svc.analyzeOffer('o1', 'c').then((r: any) => r.arguments.find((a: any) => a.title === 'Pilny termin')?.text ?? null);
  }
  afterEach(() => jest.useRealTimers());

  it('22:30Z on 10.10 (Warsaw: 11.10 00:30), loading 11.10 (date without a time) → "dzisiaj", not "jutro"', async () => {
    expect(await urgency(new Date('2030-10-11T00:00:00Z'), '2030-10-10T22:30:00Z')).toMatch(/Realizacja w ciągu dzisiaj/);
  });

  it('23:00Z on 10.10 (Warsaw: 11.10 01:00), loading 12.10 → "jutro", not "2 dni"', async () => {
    expect(await urgency(new Date('2030-10-12T00:00:00Z'), '2030-10-10T23:00:00Z')).toMatch(/Realizacja w ciągu jutro/);
  });

  it('a pickup country outside the map → the company country zone (GB): 22:30Z is still 10.10 → loading 11.10 is "jutro"', async () => {
    expect(await urgency(new Date('2030-10-11T00:00:00Z'), '2030-10-10T22:30:00Z', 'XX', { country: 'GB' })).toMatch(/Realizacja w ciągu jutro/);
  });

  it('loading in 2 days → "2 dni"; in 3 days → no argument; yesterday → no argument', async () => {
    expect(await urgency(new Date('2030-10-12T00:00:00Z'), '2030-10-10T10:00:00Z')).toMatch(/Realizacja w ciągu 2 dni/);
    expect(await urgency(new Date('2030-10-13T00:00:00Z'), '2030-10-10T10:00:00Z')).toBeNull();
    expect(await urgency(new Date('2030-10-09T00:00:00Z'), '2030-10-10T10:00:00Z')).toBeNull();
  });
});

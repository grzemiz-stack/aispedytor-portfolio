/**
 * Matching never rates a vehicle that cannot take the load as a good match.
 * Like ADR: a vehicle known not to fit stays on the list
 * with score 0 and the reason; suggestions take only the usable ones.
 * Known-bad only — unknown data (no weight, no document dates) is not a
 * reason to block. (VehicleStatus has no maintenance / inactive state, so
 * the audit's "a vehicle in maintenance scores 75" cannot happen.)
 */
import 'reflect-metadata';
import { MatchingService } from '../../src/matching/matching.service';

// A fake clock: the loading on 2030-10-10 must be in the future relative to
// NOW, not to the real day — the matching lists drop offers whose loading day has passed.
const NOW = new Date('2030-10-01T10:00:00Z');
beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
afterAll(() => jest.useRealTimers());

const VEHICLE = {
  companyId: 'c', status: 'AVAILABLE', vehicleType: 'TRUCK', trailerType: 'CURTAIN',
  maxWeightKg: 24000, currentCountry: 'PL', brand: null, model: null, plateNumber: 'P', licensePlate: 'P',
  hasAdr: false, adrClasses: [], trailers: [],
  // Document dates known and valid — a missing date is a separate topic (matching-unknown-data.spec.ts).
  technicalInspectionTo: new Date('2099-01-01'), insuranceTo: new Date('2099-01-01'), tachographLegalizationTo: new Date('2099-01-01'), availableFrom: null,
};
const OFFER = {
  companyId: 'c', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin',
  weightKg: 24000, price: 1000, currency: 'EUR', isAdr: false, adrClass: null, isFrigo: false,
  temperatureMin: null, temperatureMax: null, pickupDate: new Date('2030-10-10'),
};
const vehicle = (id: string, over: object = {}) => ({ ...VEHICLE, id, ...over });
const offer = (id: string, over: object = {}) => ({ ...OFFER, id, ...over });
const PAST = new Date('2020-01-01');

function service(offers: any[], vehicles: any[]) {
  return new MatchingService({
    offer: {
      findFirst: async ({ where }: any) => offers.find(o => o.id === where.id) ?? null,
      findMany: async () => offers,
    },
    vehicle: {
      findFirst: async ({ where }: any) => vehicles.find(v => v.id === where.id) ?? null,
      findMany: async () => vehicles,
    },
  } as any);
}
const codes = (ms: any[]) => ms.map(m => m.code);
const BLOCKED = 'Niezgodny — pojazd nie może wieźć tego ładunku.';

describe('vehicles that cannot take the load: score 0 with the reason', () => {
  it.each([
    ['expired documents', { technicalInspectionTo: PAST }, {}, 'MATCH_VEHICLE_DOCUMENTS_EXPIRED'],
    ['capacity below the known weight (1 t for 24 t)', { maxWeightKg: 1000 }, {}, 'MATCH_VEHICLE_CAPACITY_EXCEEDED'],
    ['capacity 90 % of the weight (was "close", 10 points)', { maxWeightKg: 21600 }, {}, 'MATCH_VEHICLE_CAPACITY_EXCEEDED'],
    ['tarpaulin for a reefer load', {}, { isFrigo: true }, 'MATCH_VEHICLE_NOT_REEFER'],
  ])('%s', async (_n, v, o, code) => {
    const [m] = await service([offer('o', o)], [vehicle('v', v)]).findMatchingVehicles('o', 'c');
    expect([m.matchScore, codes(m.blockedBy), m.recommendation]).toEqual([0, [code], BLOCKED]);
  });

  it('the capacity reason carries both numbers', async () => {
    const [cap] = await service([offer('o')], [vehicle('v', { maxWeightKg: 1000 })]).findMatchingVehicles('o', 'c');
    expect(cap.blockedBy[0].params).toEqual({ weightKg: 24000, maxWeightKg: 1000 });
  });

  it('several reasons at once are all given', async () => {
    const [m] = await service([offer('o', { isFrigo: true })], [vehicle('v', { maxWeightKg: 1000, insuranceTo: PAST })]).findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy).sort()).toEqual(['MATCH_VEHICLE_CAPACITY_EXCEEDED', 'MATCH_VEHICLE_DOCUMENTS_EXPIRED', 'MATCH_VEHICLE_NOT_REEFER']);
  });

  it('a blocked vehicle never becomes a dashboard suggestion', async () => {
    const s = await service([offer('o')], [vehicle('v', { technicalInspectionTo: PAST })]).getSuggestions('c');
    // Control: the same offer with an unblocked vehicle gives a suggestion — the empty
    // result is the block, not an offer that dropped out (e.g. as dead).
    const ok = await service([offer('o')], [vehicle('v')]).getSuggestions('c');
    expect([s, ok.map(x => x.offer.id)]).toEqual([[], ['o']]);
  });

  it('offers for a vehicle: an offer too heavy for it is blocked, a fitting one is not', async () => {
    const r = await service([offer('heavy'), offer('light', { weightKg: 500 })], [vehicle('v', { maxWeightKg: 1000 })]).findMatchingOffers('v', 'c');
    expect(r.map(m => [m.offerId, m.matchScore > 0, codes(m.blockedBy)])).toEqual([
      ['light', true, []],
      ['heavy', false, ['MATCH_VEHICLE_CAPACITY_EXCEEDED']],
    ]);
  });
});

describe('documents are checked on the day of loading, not today', () => {
  const DAY = 24 * 3600 * 1000;
  const inDays = (n: number) => new Date(Date.now() + n * DAY);

  it('valid today, expires before the pickup → blocked', async () => {
    const [m] = await service([offer('o', { pickupDate: inDays(30) })], [vehicle('v', { insuranceTo: inDays(10) })]).findMatchingVehicles('o', 'c');
    expect([m.matchScore, codes(m.blockedBy)]).toEqual([0, ['MATCH_VEHICLE_DOCUMENTS_EXPIRED']]);
  });

  it('valid until after the pickup → not blocked', async () => {
    const [m] = await service([offer('o', { pickupDate: inDays(10) })], [vehicle('v', { insuranceTo: inDays(30) })]).findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy)).toEqual([]);
  });

  it('no pickup date → checked against now', async () => {
    const [valid] = await service([offer('o', { pickupDate: null })], [vehicle('v', { insuranceTo: inDays(10) })]).findMatchingVehicles('o', 'c');
    const [expired] = await service([offer('o', { pickupDate: null })], [vehicle('v', { insuranceTo: inDays(-1) })]).findMatchingVehicles('o', 'c');
    expect([codes(valid.blockedBy), codes(expired.blockedBy)]).toEqual([[], ['MATCH_VEHICLE_DOCUMENTS_EXPIRED']]);
  });

  it('a document valid "until 10.10" is valid all of 10.10: loading 10.10 08:00 → not blocked', async () => {
    const [m] = await service([offer('o', { pickupDate: new Date('2030-10-10T08:00:00Z') })], [vehicle('v', { insuranceTo: new Date('2030-10-10T00:00:00Z') })]).findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy)).toEqual([]);
  });

  it('expired 9.10, loading 10.10 → blocked', async () => {
    const [m] = await service([offer('o', { pickupDate: new Date('2030-10-10T00:00:00Z') })], [vehicle('v', { insuranceTo: new Date('2030-10-09T23:59:00Z') })]).findMatchingVehicles('o', 'c');
    expect(codes(m.blockedBy)).toEqual(['MATCH_VEHICLE_DOCUMENTS_EXPIRED']);
  });

  it('offers for a vehicle: each offer is checked against its own pickup date', async () => {
    const r = await service([offer('soon', { pickupDate: inDays(5) }), offer('late', { pickupDate: inDays(60) })], [vehicle('v', { technicalInspectionTo: inDays(20) })]).findMatchingOffers('v', 'c');
    expect(r.map(m => [m.offerId, codes(m.blockedBy)])).toEqual([['soon', []], ['late', ['MATCH_VEHICLE_DOCUMENTS_EXPIRED']]]);
  });
});

describe('not blocked', () => {
  it('a usable vehicle: full score, nothing blocked', async () => {
    const [m] = await service([offer('o')], [vehicle('v', { technicalInspectionTo: new Date('2099-01-01') })]).findMatchingVehicles('o', 'c');
    expect([m.matchScore, m.blockedBy]).toEqual([100, []]);
  });

  it('unknown weight or unknown capacity is not a block (0 points for it — matching-unknown-data.spec.ts)', async () => {
    const [noWeight] = await service([offer('o', { weightKg: null })], [vehicle('v')]).findMatchingVehicles('o', 'c');
    const [noCap] = await service([offer('o')], [vehicle('v', { maxWeightKg: null })]).findMatchingVehicles('o', 'c');
    expect([codes(noWeight.blockedBy), codes(noCap.blockedBy)]).toEqual([[], []]);
  });

  it('busy but in service (IN_TRANSIT, RETURNING) is not a block — it just scores lower', async () => {
    const [m] = await service([offer('o')], [vehicle('v', { status: 'IN_TRANSIT' })]).findMatchingVehicles('o', 'c');
    expect([codes(m.blockedBy), m.matchScore > 0]).toEqual([[], true]);
  });
});

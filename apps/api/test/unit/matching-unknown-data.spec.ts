/**
 * Matching with unknown data: 0 points in the component + MATCH_DATA_UNKNOWN,
 * no block.
 *
 * Before: an unknown offer weight = 20/20 ("assume it fits"), an unknown
 * payload = 10/20, no document dates = 10/10 ("assume valid") — a vehicle
 * without data looked like a good match. Now: an unknown gives no points and
 * is named (the fields in `params.fields`), but it does not block — only what
 * is known to rule a vehicle out blocks (matching-unusable.spec.ts).
 * Document points count to the loading day (like the block), not to "today",
 * proportionally: each of the three dates (inspection, insurance, tachograph
 * calibration) known and valid = 1/3 of 10 (rounded: 0 / 3 / 7 / 10), unknown
 * = 0 and named. An unknown vehicle country = 0 of 15 for location (before 5).
 */
import 'reflect-metadata';
import { MatchingService } from '../../src/matching/matching.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

// A fake clock: the loading on 2030-10-10 must be in the future relative to
// NOW, not to the real day — the matching lists drop offers whose loading day has passed.
const NOW = new Date('2030-10-01T10:00:00Z');
beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
afterAll(() => jest.useRealTimers());

const FUTURE = new Date('2031-01-01');
const DOCS = { technicalInspectionTo: FUTURE, insuranceTo: FUTURE, tachographLegalizationTo: FUTURE };
const VEHICLE = {
  id: 'v', companyId: 'c', status: 'AVAILABLE', vehicleType: 'TRUCK', trailerType: 'CURTAIN',
  maxWeightKg: 24000, currentCountry: 'PL', brand: null, model: null, plateNumber: 'P', licensePlate: 'P',
  hasAdr: false, adrClasses: [], trailers: [], availableFrom: null, ...DOCS,
};
const OFFER = {
  id: 'o', companyId: 'c', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin',
  weightKg: 12000, price: 1000, currency: 'EUR', isAdr: false, adrClass: null, isFrigo: false,
  temperatureMin: null, temperatureMax: null, pickupDate: new Date('2030-10-10'),
};

async function match(v: object = {}, o: object = {}) {
  const vehicle = { ...VEHICLE, ...v };
  const offer = { ...OFFER, ...o };
  const s = new MatchingService({
    offer: { findFirst: async () => offer, findMany: async () => [offer] },
    vehicle: { findFirst: async () => vehicle, findMany: async () => [vehicle] },
  } as any);
  return (await s.findMatchingVehicles('o', 'c'))[0];
}
const unknown = (m: any) => m.warnings.filter((w: any) => w.code === 'MATCH_DATA_UNKNOWN');

it('everything known: 100, no MATCH_DATA_UNKNOWN', async () => {
  const m = await match();
  expect([m.matchScore, unknown(m), m.blockedBy]).toEqual([100, [], []]);
});

it.each([
  ['unknown offer weight', {}, { weightKg: null }, 'weightKg'],
  ['unknown vehicle capacity', { maxWeightKg: null }, {}, 'maxWeightKg'],
  ['both unknown', { maxWeightKg: null }, { weightKg: null }, 'weightKg,maxWeightKg'],
])('%s: capacity 0 (was 20 / 10), named, not blocked', async (_n, v, o, fields) => {
  const m = await match(v, o);
  expect([m.matchDetails.capacityOk, m.matchScore, unknown(m), m.blockedBy]).toEqual([0, 80, [{ code: 'MATCH_DATA_UNKNOWN', params: { fields } }], []]);
});

it.each([
  ['no document dates at all', { technicalInspectionTo: null, insuranceTo: null, tachographLegalizationTo: null }, 0, 'technicalInspectionTo,insuranceTo,tachographLegalizationTo'],
  ['two dates missing, one known and valid', { technicalInspectionTo: null, tachographLegalizationTo: null }, 3, 'technicalInspectionTo,tachographLegalizationTo'],
  ['the insurance date missing, two known and valid', { insuranceTo: null }, 7, 'insuranceTo'],
])('%s: documents 1/3 of 10 per known valid date (was 10), the unknown ones named, not blocked', async (_n, v, docs, fields) => {
  const m = await match(v);
  expect([m.matchDetails.docsValid, m.matchScore, unknown(m), m.blockedBy]).toEqual([docs, 90 + docs, [{ code: 'MATCH_DATA_UNKNOWN', params: { fields } }], []]);
});

it('an unknown vehicle country: location 0 of 15 (was 5), currentCountry named, not blocked', async () => {
  const m = await match({ currentCountry: null });
  expect([m.matchDetails.locationMatch, m.matchScore, unknown(m), m.blockedBy]).toEqual([0, 85, [{ code: 'MATCH_DATA_UNKNOWN', params: { fields: 'currentCountry' } }], []]);
});

it('a known other country is still 0 of 15 but not "unknown"', async () => {
  const m = await match({ currentCountry: 'DE' });
  expect([m.matchDetails.locationMatch, unknown(m)]).toEqual([0, []]);
});

it('everything unknown at once: one message with all the fields, the rest of the score stays', async () => {
  const m = await match({ maxWeightKg: null, currentCountry: null, technicalInspectionTo: null, insuranceTo: null, tachographLegalizationTo: null }, { weightKg: null });
  expect([m.matchScore, unknown(m)]).toEqual([55, [{ code: 'MATCH_DATA_UNKNOWN', params: { fields: 'weightKg,maxWeightKg,currentCountry,technicalInspectionTo,insuranceTo,tachographLegalizationTo' } }]]);
  expect(m.blockedBy).toEqual([]);
});

it('documents count to the loading day, not to today: valid then = full points (was 0 — expired by now)', async () => {
  const until = new Date('2020-02-01');
  const m = await match({ technicalInspectionTo: until, insuranceTo: until, tachographLegalizationTo: until }, { pickupDate: new Date('2020-01-05') });
  expect([m.matchDetails.docsValid, m.blockedBy]).toEqual([10, []]);
});

it('valid until exactly the loading day counts as valid (whole day, UTC)', async () => {
  const day = new Date('2030-10-10T00:00:00Z');
  const m = await match({ technicalInspectionTo: day, insuranceTo: day, tachographLegalizationTo: day }, { pickupDate: new Date('2030-10-10T15:00:00Z') });
  expect([m.matchDetails.docsValid, m.blockedBy]).toEqual([10, []]);
});

it('offers for a vehicle get the same rule', async () => {
  const vehicle = { ...VEHICLE, maxWeightKg: null };
  const s = new MatchingService({
    offer: { findFirst: async () => OFFER, findMany: async () => [OFFER] },
    vehicle: { findFirst: async () => vehicle, findMany: async () => [vehicle] },
  } as any);
  const [m] = await s.findMatchingOffers('v', 'c');
  expect([m.matchDetails.capacityOk, unknown(m)]).toEqual([0, [{ code: 'MATCH_DATA_UNKNOWN', params: { fields: 'maxWeightKg' } }]]);
});

it('MATCH_DATA_UNKNOWN is in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toContain('MATCH_DATA_UNKNOWN');
});

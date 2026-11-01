/**
 * Vehicle ↔ offer matching checks ADR (docs/decisions.md §6).
 *
 * The same rule as LTL (common/adr.ts): a vehicle that may not carry an ADR
 * load stays in the list with score 0 and the reason in `blockedBy` — it never
 * gets "good match" — and dashboard suggestions use only compatible vehicles.
 * The Swagger texts must say that ADR is checked, and nothing more.
 */
import 'reflect-metadata';
import { MatchingService } from '../../src/matching/matching.service';
import { MatchingController } from '../../src/matching/matching.controller';

// A fake clock: the loading on 2030-10-10 must be in the future relative to
// NOW, not to the real day — the matching lists drop offers whose loading day has passed.
const NOW = new Date('2030-10-01T10:00:00Z');
beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
afterAll(() => jest.useRealTimers());

const VEHICLE = {
  companyId: 'c', status: 'AVAILABLE', vehicleType: 'TRUCK', trailerType: 'CURTAIN',
  maxWeightKg: 24000, currentCountry: 'PL', brand: null, model: null, plateNumber: 'P', licensePlate: 'P',
  hasAdr: false, adrClasses: [], trailers: [],
  // Document dates known and valid — this is about ADR, not missing data (matching-unknown-data.spec.ts).
  technicalInspectionTo: new Date('2099-01-01'), insuranceTo: new Date('2099-01-01'), tachographLegalizationTo: new Date('2099-01-01'),
};
const OFFER = {
  companyId: 'c', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin',
  weightKg: 10000, price: 1000, currency: 'EUR', isAdr: false, adrClass: null, isFrigo: false,
  temperatureMin: null, temperatureMax: null,
  // Loading in the future: the matching lists drop offers whose loading day has passed.
  pickupDate: new Date('2030-10-10'),
};
const vehicle = (id: string, over: object = {}) => ({ ...VEHICLE, id, ...over });
const offer = (id: string, over: object = {}) => ({ ...OFFER, id, ...over });

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

const ADR3 = { isAdr: true, adrClass: '3' };
const codes = (ms: any[]) => ms.map(m => m.code);

describe('vehicles for an ADR offer', () => {
  it('vehicle without ADR: score 0, reason, at the end — not "good match"', async () => {
    const r = await service([offer('o', ADR3)], [
      vehicle('plain'),
      vehicle('adr', { hasAdr: true, adrClasses: ['3', '8'] }),
    ]).findMatchingVehicles('o', 'c');

    expect(r.map(m => [m.vehicleId, m.matchScore, codes(m.blockedBy)])).toEqual([
      ['adr', 100, []],
      ['plain', 0, ['OFFER_ADR_VEHICLE_NOT_CERTIFIED']],
    ]);
    expect(r[1].recommendation).toBe('Niezgodny — pojazd nie może wieźć tego ładunku.');
  });

  it('class not allowed for the vehicle → blocked with both class lists', async () => {
    const [m] = await service([offer('o', ADR3)], [vehicle('v', { hasAdr: true, adrClasses: ['8'] })]).findMatchingVehicles('o', 'c');
    expect(m.matchScore).toBe(0);
    expect(m.blockedBy).toEqual([{ code: 'OFFER_ADR_CLASS_NOT_ALLOWED', params: { offerClasses: '3', vehicleClasses: '8' } }]);
  });

  it('ADR offer without a class, vehicle with ADR → scored, with a warning (not blocked)', async () => {
    const [m] = await service([offer('o', { isAdr: true, adrClass: null })], [vehicle('v', { hasAdr: true, adrClasses: ['3'] })]).findMatchingVehicles('o', 'c');
    expect(m.matchScore).toBe(100);
    expect(codes(m.blockedBy)).toEqual([]);
    expect(codes(m.warnings)).toEqual(['OFFER_ADR_CLASS_NOT_GIVEN']);
  });

  it('non-ADR offer: score unchanged, nothing blocked', async () => {
    const [m] = await service([offer('o')], [vehicle('v')]).findMatchingVehicles('o', 'c');
    expect([m.matchScore, m.blockedBy, m.warnings]).toEqual([100, [], []]);
    expect(m.recommendation).toBe('Doskonałe dopasowanie — zdecydowanie warto przypisać.');
  });
});

describe('offers for a vehicle', () => {
  it('vehicle without ADR: the ADR offer gets 0 and the reason', async () => {
    const r = await service([offer('adr', ADR3), offer('plain')], [vehicle('v')]).findMatchingOffers('v', 'c');
    expect(r.map(m => [m.offerId, m.matchScore, codes(m.blockedBy)])).toEqual([
      ['plain', 100, []],
      ['adr', 0, ['OFFER_ADR_VEHICLE_NOT_CERTIFIED']],
    ]);
  });
});

describe('dashboard suggestions', () => {
  it('only from vehicles that may carry the load — a better-scored vehicle without ADR is skipped', async () => {
    const r = await service([offer('o', ADR3)], [
      vehicle('plain'),                                                         // 100 pts, no ADR
      vehicle('adr', { hasAdr: true, adrClasses: ['3'], status: 'RETURNING' }), // 87 pts, with ADR
    ]).getSuggestions('c');
    expect(r.map(s => [s.vehicle.id, s.matchScore])).toEqual([['adr', 87]]);
  });

  it('no compatible vehicle → no suggestion for that offer', async () => {
    const none = await service([offer('o', ADR3)], [vehicle('plain')]).getSuggestions('c');
    // Control: the same offer with an ADR vehicle gives a suggestion — the empty result
    // means no compatible vehicle, not an offer that dropped out (e.g. as dead).
    const withAdr = await service([offer('o', ADR3)], [vehicle('plain'), vehicle('adr', { hasAdr: true, adrClasses: ['3'] })]).getSuggestions('c');
    expect([none, withAdr.map(s => [s.offer.id, s.vehicle.id])]).toEqual([[], [['o', 'adr']]]);
  });
});

describe('Swagger says what the code does', () => {
  const op = (m: string) => Reflect.getMetadata('swagger/apiOperation', (MatchingController.prototype as any)[m]);

  it('ADR is described as checked, with where the reason goes', () => {
    expect(op('vehicleForOffer').description).toMatch(/ADR is checked.*blockedBy/);
    expect(op('offersForVehicle').description).toMatch(/blockedBy/);
    expect(op('suggestions').summary).toMatch(/only ADR-compatible vehicles/);
  });
});

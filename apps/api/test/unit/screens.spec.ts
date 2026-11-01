/**
 * Screens: LTL offers that cannot be measured and the dashboard
 * recommendations.
 *
 * Before: LTL `unmeasurable` carried only the id and what was missing, and the
 * screen did not read it — offers without weight or dimensions vanished. A
 * dashboard recommendation had only `route` "PL→DE" — "Planuj trasę" sent the
 * planner countries instead of cities, and took the price from the list of
 * recent offers, which might not include the evaluated one.
 * Now:
 *  - `unmeasurable`: the 20 with the nearest loading (then id), with the route,
 *    date and what is missing; `unmeasurableTotal` — the full number;
 *  - the evaluation result carries both ends' cities and countries and the
 *    price with its currency; `route` stays, deprecated in Swagger.
 */
import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';
import { AiEvaluationService } from '../../src/ai-evaluation/ai-evaluation.service';
import { AiEvaluationController } from '../../src/ai-evaluation/ai-evaluation.controller';

const vehicle = {
  id: 'veh-1', companyId: 'c', plateNumber: 'GD 12345', vehicleType: 'TRUCK', trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6, maxWeightKg: 24000, maxPalletCount: 33, grossVehicleWeightKg: 40000, curbWeightKg: 15000,
};
const DAY = 86_400_000;
// "Now" injected: the loadings 2030-10-01…21 must be in the future relative to NOW, not to the real day.
const NOW = new Date('2030-09-20T10:00:00Z');
const offer = (id: string, over: Record<string, any> = {}) => ({
  id, companyId: 'c', status: 'NEW', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
  pickupLat: 52.4, pickupLng: 16.9, deliveryLat: 52.5, deliveryLng: 13.4, weightKg: 3000, lengthM: 2.4, palletCount: 2,
  price: 900, currency: 'EUR', pricePerKm: 1.5, cargoType: 'Palety', pickupDate: new Date('2030-10-01'),
  contractor: { id: 'k-1', name: 'K', reliabilityScore: 80 }, ...over,
});

async function ltl(offers: any[]) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const svc = new LtlMatchingService(prisma, {} as any);
  svc.now = () => NOW;
  (svc as any).geocode = jest.fn().mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 }).mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
  return (await svc.findMatchingOffers('c', {
    vehicleId: 'veh-1', currentCity: 'Poznań', destinationCity: 'Berlin', currentLoadWeight: 2, currentLoadMeters: 5, maxDetourKm: 300,
  } as any)) as any;
}

describe('offers that cannot be measured', () => {
  // 21 offers without weight; the dates shuffled so the order is not the database order.
  const unmeasured = Array.from({ length: 21 }, (_, i) =>
    offer(`u${String(i).padStart(2, '0')}`, { weightKg: null, pickupDate: new Date(Date.UTC(2030, 9, 1) + ((i * 8) % 21) * DAY) }));

  it('21 offers: the total is 21, the list holds the 20 with the nearest loading, the 21st left out', async () => {
    const res = await ltl([...unmeasured, offer('ok')]);
    expect(res.unmeasurableTotal).toBe(21);
    expect(res.unmeasurable).toHaveLength(20);
    const dates = res.unmeasurable.map((u: any) => u.pickupDate.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    const latest = unmeasured.reduce((a, b) => (a.pickupDate > b.pickupDate ? a : b));
    expect(res.unmeasurable.map((u: any) => u.offerId)).not.toContain(latest.id);
  });

  it('each one carries the route, the loading date and what is missing', async () => {
    const res = await ltl([offer('nic', { weightKg: null, lengthM: null, palletCount: null, pickupCity: 'Łódź', deliveryCity: 'Praga', deliveryCountry: 'CZ' })]);
    expect(res.unmeasurable).toEqual([{
      offerId: 'nic', pickupCity: 'Łódź', pickupCountry: 'PL', deliveryCity: 'Praga', deliveryCountry: 'CZ',
      pickupDate: new Date('2030-10-01'), missing: ['weightKg', 'dimensions'],
    }]);
    expect(res.unmeasurableTotal).toBe(1);
  });

  it('the same loading day: by id, so the order does not depend on the database', async () => {
    const res = await ltl([offer('b', { weightKg: null }), offer('a', { weightKg: null })]);
    expect(res.unmeasurable.map((u: any) => u.offerId)).toEqual(['a', 'b']);
  });

  it('none: an empty list and a total of 0 — the measured offer is in the matches', async () => {
    const res = await ltl([offer('ok')]);
    // An empty list would also pass if the offer had dropped out (e.g. as dead) — hence `matches`.
    expect([res.unmeasurable, res.unmeasurableTotal, res.matches.map((m: any) => m.offerId)]).toEqual([[], 0, ['ok']]);
  });
});

describe('the recommendation carries the places and the price', () => {
  const OFFER = {
    id: 'o1', companyId: 'c', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
    price: 1800, currency: 'EUR', pricePerKm: 3, profitMarginPercent: null, status: 'NEW',
  };
  const svc = () => new AiEvaluationService(
    { offer: { findFirst: async () => OFFER, findMany: async () => [] }, company: { findUnique: async () => ({ costCurrency: 'PLN' }) } } as any,
    { enqueue: (fn: any) => fn() } as any,
  );

  it('the result has both cities and countries and the price with its currency; route stays', async () => {
    const r: any = await svc().evaluateOffer('o1', 'c');
    expect([r.pickupCity, r.pickupCountry, r.deliveryCity, r.deliveryCountry, r.price, r.currency, r.route])
      .toEqual(['Poznań', 'PL', 'Berlin', 'DE', 1800, 'EUR', 'PL→DE']);
  });

  it('no price → price null (not 0)', async () => {
    const s = new AiEvaluationService(
      { offer: { findFirst: async () => ({ ...OFFER, price: null }), findMany: async () => [] }, company: { findUnique: async () => null } } as any,
      { enqueue: (fn: any) => fn() } as any,
    );
    expect((await s.evaluateOffer('o1', 'c') as any).price).toBeNull();
  });

  it.each(['evaluateOffer', 'batchEvaluate'])('Swagger (%s): `route` is deprecated, the places are described', (method) => {
    const responses = Reflect.getMetadata(DECORATORS.API_RESPONSE, (AiEvaluationController.prototype as any)[method]);
    const schema = responses['200'].schema;
    const props = (schema.items ?? schema).properties;
    expect(props.route.deprecated).toBe(true);
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['pickupCity', 'pickupCountry', 'deliveryCity', 'deliveryCountry', 'price', 'currency']));
  });
});

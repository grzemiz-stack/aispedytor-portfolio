/**
 * Once a TollProvider is registered, toll flows through the whole system:
 * planner → route_calculations row → LTL detour toll and negotiation cost.
 *
 * Uses the test-only FixedRateTollProvider (arbitrary rates). Shows the
 * wiring, not real toll amounts.
 */
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { offerValue } from '../../src/ltl-matching/offer-value';
import { NegotiationService } from '../../src/negotiation/negotiation.service';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const ROUTE = {
  distance: 400_000, duration: 18_000, polyline: '', sections: [],
  countries: [{ countryCode: 'PL', distanceKm: 100 }, { countryCode: 'DE', distanceKm: 300 }],
};
const DTO: any = {
  origin: { lat: 52.4, lng: 16.9 }, destination: { lat: 52.5, lng: 13.4 },
  vehicle: { grossWeight: 40000, height: 4, width: 2.55, length: 16.5, axleCount: 5, euroClass: 'Euro6', hasAdr: false },
  offerId: 'off-1',
};

async function savedRow() {
  const created: any[] = [];
  const prisma: any = {
    offer: { findFirst: jest.fn().mockResolvedValue({ id: 'off-1' }), update: jest.fn(async () => ({})) },
    // The company cost per km (offer cost = rate × km + toll).
    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
    // findFirst — the offer margin is recomputed from the saved route.
    routeCalculation: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }), findFirst: async () => created[created.length - 1] ?? null },
  };
  const planner = new RoutePlannerService(
    { calculateRoute: jest.fn().mockResolvedValue([ROUTE]) } as any,
    { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() } as any, prisma, new FixedRateTollProvider(),
  );
  await planner.calculateRoute(DTO, 'comp-1');
  return { ...created[0], calculatedAt: new Date('2026-10-05T10:00:00Z') };
}

it('planner saves the provider\'s toll with its source', async () => {
  // PL 100 × 0.40 PLN = 40 PLN = 9.20 EUR; DE 300 × 0.20 EUR = 60 EUR → 69.20 EUR.
  expect(await savedRow()).toMatchObject({ tollSource: 'fake-fixed-rate', tollTotalEur: 69.2, distanceKm: 400, axleClass: '5+' });
});

it('LTL counts the detour toll from that row: 50 km × 69.20/400 EUR/km = 8.65 EUR', async () => {
  const row = await savedRow();
  const v = offerValue({
    price: 1200, priceCurrency: 'EUR', detourKm: 50,
    company: { costPerKm: 1, costCurrency: 'EUR' },
    vehicleAxleClass: '5+',
    routeCalculations: [row],
    tollProviderConfigured: true,
  });
  expect(v.detourToll).toBeCloseTo(8.65, 6);
  expect(v.amount).toBeCloseTo(1200 - 50 - 8.65, 6);
  expect(v.codes.map(c => c.code)).toEqual(['DETOUR_TOLL_ESTIMATED']);
});

it('negotiation uses the same row: toll 69.20 EUR = 300.87 PLN, simulation available', async () => {
  const row = await savedRow();
  const prisma: any = {
    offer: {
      findFirst: async () => ({ id: 'off-1', price: 1500, currency: 'EUR', distanceKm: 400, tollCostEstimate: null, pickupCountry: 'PL', deliveryCountry: 'DE' }),
      findMany: async () => [],
    },
    // The company cost per km (offer cost = rate × km + toll).
    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },
    routeCalculation: { findFirst: async () => row },
  };
  const s = await new NegotiationService(prisma, new FixedRateTollProvider()).simulateNegotiation('off-1', 1500, 'comp-1');
  expect(s.available).toBe(true);
  expect(s.tollCost).toMatchObject({ source: 'calculated', amountPLN: 300.87 });
});

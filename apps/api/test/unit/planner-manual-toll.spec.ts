/**
 * The planner opened for an offer computes the cost with its manual toll —
 * in the same order as the saved margin and negotiation.
 *
 * Before: `offerCost({ ..., manualToll: null })` also with `offerId` — an offer
 * with a manual toll had another margin in the planner than on the list and in
 * negotiation (`offerCost` puts the manual toll before the route toll).
 * Now: with `offerId` (an offer of the company) the planner takes the offer's
 * `tollCostEstimate` in its currency; without `offerId` — as before (the route toll).
 */
import 'reflect-metadata';
import { RoutePlannerService } from '../../src/route-planner/route-planner.service';
import { economicsWithRate } from '../../src/offers/offer-economics';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

const VEHICLE = { grossWeight: 40000, height: 4, width: 2.55, length: 16.5, hasAdr: false };
const RATE = { costPerKm: 4.2, costCurrency: 'PLN' };
const OFFER = { id: 'o1', price: 2000, currency: 'EUR', distanceKm: 280, tollCostEstimate: 120 };
const ROUTE = {
  distance: 300000, duration: 12000, polyline: '52.4,16.9;52.5,13.4', estimated: false, sections: [],
  countries: [{ countryCode: 'PL', distanceKm: 150 }, { countryCode: 'DE', distanceKm: 150 }],
};

function planner() {
  const prisma: any = {
    company: { findUnique: jest.fn(async () => RATE) },
    offer: { findFirst: jest.fn(async () => OFFER), update: jest.fn() },
    routeCalculation: { create: jest.fn(), findFirst: jest.fn(async () => null) },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { svc: new RoutePlannerService({ calculateRoute: async () => [ROUTE] } as any, cache, prisma, new FixedRateTollProvider()), prisma };
}
const dto = (over: object = {}): any => ({ origin: { lat: 52.4, lng: 16.9 }, destination: { lat: 52.5, lng: 13.4 }, vehicle: VEHICLE, currency: 'EUR', freightRate: 2000, ...over });

it('with offerId: the route cost uses the offer\'s manual toll (120 EUR), not the route toll — the planner margin = the stored margin', async () => {
  const { svc } = planner();
  const res: any = await svc.calculateRoute(dto({ offerId: 'o1' }), 'c1');
  // The saved margin of this offer with this route: km from the route (300), the manual toll first (offerCost).
  const stored = economicsWithRate({ ...OFFER }, RATE, { distanceKm: 300, tollEUR: res.routes[0].costs.tolls.totalEUR });
  expect(res.routes[0].margin.marginPercent).toBe(stored.profitMarginPercent);
  expect(res.routes[0].costs.totalCostEUR).toBeCloseTo(stored.totalCostEstimate!, 2);
});

it('the offer is read in the caller\'s company', async () => {
  const { svc, prisma } = planner();
  await svc.calculateRoute(dto({ offerId: 'o1' }), 'c1');
  expect(prisma.offer.findFirst.mock.calls[0][0].where).toEqual({ id: 'o1', companyId: 'c1' });
});

it('without offerId: the route toll, as before', async () => {
  const { svc, prisma } = planner();
  const res: any = await svc.calculateRoute(dto(), 'c1');
  const fromRoute = economicsWithRate({ ...OFFER, tollCostEstimate: null }, RATE, { distanceKm: 300, tollEUR: res.routes[0].costs.tolls.totalEUR });
  expect(res.routes[0].margin.marginPercent).toBe(fromRoute.profitMarginPercent);
  expect(prisma.offer.findFirst).not.toHaveBeenCalled();
});

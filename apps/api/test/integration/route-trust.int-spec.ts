/**
 * Fallback routes in the database — on a real Postgres, because the rule is a
 * JSON filter (`toll_breakdown = []`) a mock cannot check.
 *
 * Before, the planner also saved a fallback route with an offer: a flat 500 km
 * (no countries — an empty toll breakdown) or 0 km from an adapter error. Such
 * rows do not reach the offer cost (`economicsFor`, `offers:recompute-economics`,
 * negotiation, LTL), and the recompute command says how many it skipped. A real
 * 500 km route with toll (a non-empty breakdown) is an ordinary route.
 */
import { PrismaClient } from '@prisma/client';
import { economicsFor } from '../../src/offers/offer-economics';
import { recomputeEconomics } from '../../src/offers/recompute-economics';

const prisma = new PrismaClient();
let companyId: string;
let offerId: string;
const route = (distanceKm: number, tollTotalEur: number, breakdown: object[], at: string) => ({
  offerId, companyId, distanceKm, tollTotalEur, tollTotalPln: tollTotalEur * 4.3, tollBreakdown: breakdown, tollUnresolved: [], tollSource: 'test-provider',
  calculatedAt: new Date(at),
});

beforeAll(async () => {
  const c = await prisma.company.create({ data: { name: 'Route Trust Test', taxId: 'RT-1', country: 'PL', costPerKm: 4.2, costCurrency: 'PLN' } as any });
  companyId = c.id;
  const o = await prisma.offer.create({
    data: { companyId, pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: new Date(Date.now() + 3 * 864e5), price: 1000, currency: 'EUR', distanceKm: 280 },
  });
  offerId = o.id;
});
afterAll(async () => {
  await prisma.routeCalculation.deleteMany({ where: { companyId } });
  await prisma.offer.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

it('the newest suspected rows (flat 500 km without a toll breakdown, 0 km) are skipped — the trusted older route counts', async () => {
  await prisma.routeCalculation.createMany({ data: [
    route(300, 50, [{ countryCode: 'PL', costEUR: 50 }], '2026-10-01T10:00:00Z'),
    route(500, 0, [], '2026-10-02T10:00:00Z'),
    route(0, 0, [], '2026-10-03T10:00:00Z'),
  ] });
  const e = await economicsFor(prisma as any, companyId, { id: offerId, price: 1000, currency: 'EUR', distanceKm: 280, tollCostEstimate: null });
  const fromTrusted = await economicsFor(prisma as any, companyId, { price: 1000, currency: 'EUR', distanceKm: 300, tollCostEstimate: 50 });
  expect([e.totalCostEstimate, e.marginWithoutTolls]).toEqual([fromTrusted.totalCostEstimate, false]);
});

it('offers:recompute-economics counts the skipped rows', async () => {
  const r = await recomputeEconomics(prisma as any, { companyId, dryRun: true });
  expect([r.offers, r.suspectRoutes]).toEqual([1, 2]);
});

it('a real 500 km route WITH a toll breakdown is an ordinary route', async () => {
  await prisma.routeCalculation.create({ data: route(500, 90, [{ countryCode: 'DE', costEUR: 90 }], '2026-10-04T10:00:00Z') });
  const e = await economicsFor(prisma as any, companyId, { id: offerId, price: 1000, currency: 'EUR', distanceKm: 280, tollCostEstimate: null });
  const from500 = await economicsFor(prisma as any, companyId, { price: 1000, currency: 'EUR', distanceKm: 500, tollCostEstimate: 90 });
  expect(e.totalCostEstimate).toBe(from500.totalCostEstimate);
});

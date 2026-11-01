/**
 * Everyone who reads a saved planner route for a cost skips fallback routes:
 * the offer economics, the recompute, negotiation (cost and toll) and LTL (the
 * detour toll). The rule itself (a JSON filter) is checked on Postgres —
 * test/integration/route-trust.int-spec.ts; here — that the readers use it.
 */
import 'reflect-metadata';
import { TRUSTED_ROUTE } from '../../src/common/route-trust';
import { NegotiationService } from '../../src/negotiation/negotiation.service';

const OFFER = { id: 'o1', tollCostEstimate: null, currency: 'EUR' };

function negotiation() {
  const prisma: any = {
    routeCalculation: { findFirst: jest.fn(async () => null) },
    company: { findUnique: jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' })) },
  };
  return { svc: new NegotiationService(prisma) as any, prisma };
}

it('negotiation — the offer cost reads only a trusted route', async () => {
  const { svc, prisma } = negotiation();
  await svc.offerCostOf(OFFER, 280, 'c1');
  expect(prisma.routeCalculation.findFirst.mock.calls[0][0].where).toEqual({ offerId: 'o1', ...TRUSTED_ROUTE });
});

it('negotiation — the toll reads only a trusted route', async () => {
  const { svc, prisma } = negotiation();
  await svc.resolveTollCost(OFFER);
  expect(prisma.routeCalculation.findFirst.mock.calls[0][0].where).toEqual({ offerId: 'o1', ...TRUSTED_ROUTE });
});

it('LTL — the detour toll gets only trusted routes (the include of the candidate query)', async () => {
  const { LtlMatchingService } = await import('../../src/ltl-matching/ltl-matching.service');
  const findMany: jest.Mock = jest.fn(async () => []);
  const prisma: any = {
    vehicle: { findFirst: jest.fn(async () => ({ id: 'v', companyId: 'c1', plateNumber: 'P', vehicleType: 'TRUCK', trailerType: 'CURTAIN', maxLoadingMeters: 13.6, maxWeightKg: 24000, maxPalletCount: 33, grossVehicleWeightKg: 40000, curbWeightKg: 15000 })) },
    offer: { findMany },
    company: { findUnique: jest.fn(async () => null) },
  };
  const svc: any = new LtlMatchingService(prisma, {} as any);
  svc.geocode = jest.fn().mockResolvedValueOnce({ lat: 52.4, lng: 16.9 }).mockResolvedValueOnce({ lat: 52.5, lng: 13.4 });
  await svc.findMatchingOffers('c1', { vehicleId: 'v', currentCity: 'Poznań', destinationCity: 'Berlin', currentLoadWeight: 0, currentLoadMeters: 0, maxDetourKm: 300 });
  expect((findMany.mock.calls[0] as any[])[0].include.routeCalculations.where).toEqual(TRUSTED_ROUTE);
});

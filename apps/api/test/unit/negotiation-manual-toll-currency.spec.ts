/**
 * Negotiation: the manual toll of an offer is in the offer currency.
 *
 * The offer form computes it in the offer currency and the offer screen shows
 * it with `offer.currency`, so negotiation converts it to PLN through
 * common/fx; a currency without a rate gives no PLN amount.
 *
 * Rates from common/fx.ts: 1 EUR = 1 / 0.23 PLN, 1 GBP = 1.15 / 0.23 = 5 PLN.
 */import { NegotiationService } from '../../src/negotiation/negotiation.service';

const OFFER = {
  id: 'off-1', companyId: 'comp-1', pickupCity: 'Warszawa', deliveryCity: 'Berlin',
  pickupCountry: 'PL', deliveryCountry: 'DE', pickupDate: new Date('2026-10-01'),
  distanceKm: 800, price: 4000, currency: 'PLN', pricePerKm: 5, weightKg: 24000,
  cargoType: 'Palety', isAdr: false, tollCostEstimate: null as number | null,
  contractorId: null, contractor: null,
};

function makeService(offer: Partial<typeof OFFER>, calculation: { tollTotalEur: number } | null = null) {
  const row = { ...OFFER, ...offer };
  const prisma: any = {
    offer: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _avg: {}, _min: {}, _max: {}, _count: { id: 0 } }),
    },
    contractor: { findFirst: jest.fn().mockResolvedValue(null) },
    // The company cost per km (offer cost = rate × km + toll).

    company: { findUnique: jest.fn().mockResolvedValue({ costPerKm: 4.2, costCurrency: 'PLN' }) },

    routeCalculation: {
      findFirst: jest.fn().mockResolvedValue(calculation && {
        id: 'rc-1', offerId: 'off-1', distanceKm: 800, tollTotalEur: calculation.tollTotalEur,
        tollBreakdown: [], tollUnresolved: [], tollNeedsVerification: false,
        calculatedAt: new Date('2026-09-08T10:00:00.000Z'),
      }),
    },
  };
  return { service: new NegotiationService(prisma), row };
}

const tollCost = (s: NegotiationService, row: object) => (s as any).resolveTollCost(row);

describe('manual toll in the offer currency', () => {
  it('EUR offer: 320 EUR → 1391.30 PLN, not 320 PLN', async () => {
    const { service, row } = makeService({ currency: 'EUR', tollCostEstimate: 320 });
    const t = await tollCost(service, row);
    expect(t).toMatchObject({ source: 'manual', enteredByUser: true, amountPLN: 1391.3 });
  });

  it('GBP offer: 100 GBP → 500 PLN', async () => {
    const { service, row } = makeService({ currency: 'GBP', tollCostEstimate: 100 });
    expect((await tollCost(service, row)).amountPLN).toBe(500);
  });

  it('PLN offer: unchanged', async () => {
    const { service, row } = makeService({ currency: 'PLN', tollCostEstimate: 320 });
    expect((await tollCost(service, row)).amountPLN).toBe(320);
  });

  it('a manual toll of 0 is a value (0 PLN), also in EUR', async () => {
    const { service, row } = makeService({ currency: 'EUR', tollCostEstimate: 0 });
    expect(await tollCost(service, row)).toMatchObject({ source: 'manual', amountPLN: 0 });
  });

  it('currency without a rate → manual, but no PLN amount and no difference', async () => {
    const { service, row } = makeService({ currency: 'USD', tollCostEstimate: 320 }, { tollTotalEur: 100 });
    expect(await tollCost(service, row)).toMatchObject({ source: 'manual', amountPLN: null, differencePLN: null });
  });

  it('the difference to the planner is computed in PLN on both sides', async () => {
    // Planner: 100 EUR = 434.78 PLN; manual 100 EUR = 434.78 PLN → difference 0.
    const { service, row } = makeService({ currency: 'EUR', tollCostEstimate: 100 }, { tollTotalEur: 100 });
    expect(await tollCost(service, row)).toMatchObject({ amountPLN: 434.78, calculatedAmountPLN: 434.78, differencePLN: 0 });
  });
});

it('the simulation uses the converted manual toll in its costs', async () => {
  const { service } = makeService({ currency: 'EUR', tollCostEstimate: 320, price: 1000 });
  (service as any).getPriceSuggestion = jest.fn().mockResolvedValue({ suggestedPrice: 1000 });
  const r: any = await service.simulateNegotiation('off-1', 1000, 'comp-1');
  // estimatedCosts are rounded to whole PLN (Math.round) — 1391, not 320.
  expect(r.estimatedCosts.tollPLN).toBe(1391);
});

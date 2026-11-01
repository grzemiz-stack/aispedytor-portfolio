/**
 * The margin preview in the new-offer form = what is saved with the offer.
 *
 * Before: the form computed its own cost = fuel + toll and a verdict ("Dobra
 * opłacalność"), while the API saved cost = company rate × km + toll — 600 EUR,
 * 580 km: the form said 51.7 % "good", the saved margin was −7.9 %.
 * Now: `POST /offers/economics-preview` computes with the same function as
 * `create` (`economicsWithRate` → `offerCost`) and returns the cost codes. The
 * test calls both with the same fields and compares — also without a manual
 * toll (the margin is an upper bound, `marginWithoutTolls: true`, the toll
 * comes with the route), without a company rate and without a distance.
 */
import 'reflect-metadata';
import { OffersService } from '../../src/offers/offers.service';

function service(rate: { costPerKm: number | null; costCurrency: string }) {
  const created: any[] = [];
  const prisma: any = {
    company: { findUnique: jest.fn(async () => rate) },
    offer: { create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'o1', ...data }; }) },
    routeCalculation: { findFirst: jest.fn(async () => null) },
    contractor: { findFirst: jest.fn() },
  };
  const svc = new OffersService(
    prisma,
    { checkNewOfferAgainstDemands: async () => [] } as any,
    { deleteByPrefix: () => undefined } as any,
    { enqueue: async () => undefined } as any,
  );
  return { svc, created };
}

const BASE = { pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: '2030-10-12' };
const PICK = ['totalCostEstimate', 'profitEstimate', 'profitMarginPercent', 'marginWithoutTolls'] as const;
const pick = (o: any) => Object.fromEntries(PICK.map((k) => [k, o[k] ?? null]));

describe.each([
  ['a manual toll → a full margin', { costPerKm: 4.2, costCurrency: 'PLN' }, { price: 600, currency: 'EUR', distanceKm: 580, tollCostEstimate: 87 }, false, []],
  ['no toll → an upper bound (toll comes with the route)', { costPerKm: 4.2, costCurrency: 'PLN' }, { price: 1800, currency: 'EUR', distanceKm: 580 }, true, ['OFFER_COST_ESTIMATED', 'OFFER_COST_WITHOUT_TOLLS']],
  ['no company rate → nothing, said with a code', { costPerKm: null, costCurrency: 'PLN' }, { price: 1800, currency: 'EUR', distanceKm: 580 }, null, ['OFFER_COST_RATE_MISSING']],
  ['no distance → nothing, said with a code', { costPerKm: 4.2, costCurrency: 'PLN' }, { price: 1800, currency: 'EUR' }, null, ['OFFER_COST_NO_DISTANCE']],
])('%s', (_n, rate, fields, upperBound, codes) => {
  it('the preview = what create saves (cost, profit, margin, upper-bound flag)', async () => {
    const { svc, created } = service(rate);
    const preview: any = await svc.economicsPreview('c1', fields as any);
    await svc.create('c1', { ...BASE, ...fields } as any);
    expect(pick(preview)).toEqual(pick(created[0]));
    expect(preview.marginWithoutTolls).toBe(upperBound);
    expect(preview.messages.map((m: any) => m.code)).toEqual(expect.arrayContaining(codes));
  });
});

it('the K2 example: 600 EUR, 580 km, 4.20 PLN/km, toll 87 EUR → a loss, not "51.7 % good"', async () => {
  const { svc } = service({ costPerKm: 4.2, costCurrency: 'PLN' });
  const p: any = await svc.economicsPreview('c1', { price: 600, currency: 'EUR', distanceKm: 580, tollCostEstimate: 87 } as any);
  expect(p.profitMarginPercent).toBeLessThan(0);
  expect(p.marginWithoutTolls).toBe(false);
});

it('the route: POST /offers/economics-preview, behind login, the company from the token', async () => {
  const { OffersController } = await import('../../src/offers/offers.controller');
  const service: any = { economicsPreview: jest.fn(async () => ({})) };
  const ctrl = new OffersController(service);
  await (ctrl as any).economicsPreview({ price: 1 }, { user: { companyId: 'c1', userId: 'u', role: 'DISPATCHER' } });
  expect(service.economicsPreview).toHaveBeenCalledWith('c1', { price: 1 });
  expect(Reflect.getMetadata('path', OffersController.prototype.economicsPreview)).toBe('economics-preview');
});

it('no currency given: the cost is computed in the currency the offer is saved in (EUR), not another default', async () => {
  const { svc, created } = service({ costPerKm: 4.2, costCurrency: 'PLN' });
  await svc.create('c1', { ...BASE, price: 1800, distanceKm: 580, tollCostEstimate: 87 } as any);
  const { economicsWithRate } = await import('../../src/offers/offer-economics');
  const inEur = economicsWithRate({ price: 1800, currency: 'EUR', distanceKm: 580, tollCostEstimate: 87 }, { costPerKm: 4.2, costCurrency: 'PLN' });
  expect([created[0].currency, created[0].totalCostEstimate]).toEqual(['EUR', inEur.totalCostEstimate]);
});

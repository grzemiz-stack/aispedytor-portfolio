/**
 * Heuristic offer score (ai-evaluation) — the average price per km and currencies.
 *
 * The history average is converted through common/fx to the offer's currency; a
 * rate in a currency without an exchange rate is left out and counted. The
 * recommendation text labels rates with the offer's currency.
 *
 * Offer: 8.00 PLN/km, margin 18 %. History PL→DE: 2.0 EUR/km, 8.0 PLN/km,
 * 1.5 GBP/km = 8.70 + 8.00 + 7.50 PLN → average 8.07 → −0.8 % ("at market"),
 * score 8 (from the margin, no adjustment).
 *
 * A raw average of the numbers as they are, (2 + 8 + 1.5) / 3 = 3.83, labelled
 * "€/km", would put the offer at +108.7 % "above market" with a score of 9.
 */
import { AiEvaluationService } from '../../src/ai-evaluation/ai-evaluation.service';

const HISTORY = [
  { pricePerKm: 2.0, currency: 'EUR', createdAt: new Date('2026-09-01') },
  { pricePerKm: 8.0, currency: 'PLN', createdAt: new Date('2026-09-02') },
  { pricePerKm: 1.5, currency: 'GBP', createdAt: new Date('2026-09-03') },
];
const OFFER = {
  id: 'o', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin',
  currency: 'PLN', price: 6400, pricePerKm: 8.0, profitMarginPercent: 18,
};

let prisma: any;
function evaluate(offer: object = OFFER, history = HISTORY) {
  prisma = { offer: { findMany: jest.fn().mockResolvedValue(history) } };
  const service = new AiEvaluationService(prisma, { enqueue: (fn: any) => fn() } as any);
  return (service as any).computeEvaluation(offer, 'c');
}

describe('ai-evaluation market average in the offer currency through fx', () => {
  it('PLN offer vs mixed-currency history: −0.8 % "at market", score 8', async () => {
    const r = await evaluate();
    expect([r.priceVsMarket, r.pricePerKmRating, r.score]).toEqual([-0.8, 'at', 8]);
    expect(r.messages.map((m: any) => [m.code, m.params.from, m.params.to])).toEqual([
      ['FX_RATE_STATIC', 'EUR', 'PLN'],
      ['FX_RATE_STATIC', 'GBP', 'PLN'],
    ]);
  });

  it('the history query fetches each offer\'s currency (without it nothing could be converted)', async () => {
    await evaluate();
    expect(prisma.offer.findMany.mock.calls[0][0].select).toMatchObject({ pricePerKm: true, currency: true });
  });

  it('recommendation labels rates with the offer currency, not €/km', async () => {
    const r = await evaluate();
    expect(r.recommendation).toContain('(8.00 PLN/km)');
    expect(r.recommendation).toContain('(8.07 PLN/km na tej trasie)');
    expect(r.recommendation).not.toContain('€/km');
  });

  it('history rate in a currency without a rate is left out and counted', async () => {
    const r = await evaluate(OFFER, [...HISTORY, { pricePerKm: 99, currency: 'USD', createdAt: new Date('2026-09-04') }]);
    expect(r.priceVsMarket).toBe(-0.8);
    expect(r.messages).toContainEqual({ code: 'TOTAL_EXCLUDES_UNCONVERTED', params: { count: 1, from: 'USD', to: 'PLN' } });
  });

  it('offer in a currency without a rate: only same-currency history counts; none → no market comparison', async () => {
    const r = await evaluate({ ...OFFER, currency: 'USD' });
    expect([r.priceVsMarket, r.pricePerKmRating]).toEqual([null, 'unknown']);
  });
});

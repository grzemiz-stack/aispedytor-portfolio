/**
 * AiEvaluationService — deterministic profitability score of offers (1-10).
 *
 * Despite the module name there is no LLM and no network call here — only
 * statistics on the company's own history. Prisma and the queue are replaced
 * by simple in-memory objects (no HTTP mocks).
 */
import { AiEvaluationService } from '../../src/ai-evaluation/ai-evaluation.service';

type Hist = { pricePerKm: number; createdAt: Date };

function makeService(historical: Hist[] = []) {
  const prisma: any = {
    offer: {
      findFirst: jest.fn(),
      // A database row always has a currency (NOT NULL column); the test offer is in EUR.
      findMany: jest.fn().mockResolvedValue(historical.map(h => ({ currency: 'EUR', ...h }))),
    },
  };
  const queue: any = { enqueue: (fn: () => any) => Promise.resolve(fn()) };
  return { service: new AiEvaluationService(prisma, queue), prisma };
}

const baseOffer = {
  id: 'off-1',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pickupCity: 'Warszawa',
  deliveryCity: 'Berlin',
  currency: 'EUR',
  price: 1200,
  pricePerKm: 2.0,
  profitMarginPercent: 18,
};

const evaluate = (service: AiEvaluationService, offer: any) =>
  (service as any).computeEvaluation(offer, 'comp-1');

describe('AiEvaluationService — calcScore', () => {
  const score = (margin: number | null, pvm: number | null) =>
    (makeService().service as any).calcScore(margin, pvm);

  describe('base from the margin', () => {
    it.each([
      [25, 9],
      [20.1, 9],
      [17, 8],
      [15, 8],
      [12, 7],
      [10, 7],
      [7, 5],
      [5, 5],
      [2, 3],
      [0, 3],
      [-5, 1],
    ])('margin %p%% -> score %p', (margin, expected) => {
      expect(score(margin, null)).toBe(expected);
    });

    it('unknown margin gives a neutral 5', () => {
      expect(score(null, null)).toBe(5);
    });
  });

  describe('adjustment for the position against the average', () => {
    it('rate more than 15% above the average adds 1', () => {
      expect(score(12, 20)).toBe(8); // 7 + 1
    });

    it('rate more than 5% above the average adds 0.5 (rounded up)', () => {
      expect(score(12, 10)).toBe(8); // round(7.5)
    });

    it('rate more than 10% below the average subtracts 1.5 (7 - 1.5 rounds to 6)', () => {
      expect(score(12, -20)).toBe(6); // round(5.5)
    });

    it('score is clamped to 1-10', () => {
      expect(score(25, 50)).toBe(10);
      expect(score(-50, -50)).toBe(1);
    });
  });

  describe('known flaw: the -0.5 penalty never changes the score, the +0.5 bonus always does', () => {
    it.each([
      [25, 9],
      [12, 7],
      [7, 5],
      [2, 3],
    ])('margin %p: a rate 6-10%% below the average scores the same as one at the average (%p)', (margin, expected) => {
      expect(score(margin, -7)).toBe(expected);
      expect(score(margin, 0)).toBe(expected);
    });

    it.each([
      [25, 10],
      [12, 8],
      [7, 6],
      [2, 4],
    ])('margin %p: a rate 6-15%% above the average always raises the score (-> %p)', (margin, expected) => {
      expect(score(margin, 10)).toBe(expected);
    });

    // Math.round(x.5) rounds up and every base is a whole number, so base - 0.5
    // rounds back to base while base + 0.5 rounds to base + 1. Effect: the score is
    // biased upwards — offers slightly below the average are not penalised.
  });
});

describe('AiEvaluationService — computeEvaluation', () => {
  it('no history: no comparison with the average, popularity 0', async () => {
    const { service } = makeService([]);
    const r = await evaluate(service, baseOffer);

    expect(r.routePopularity).toBe(0);
    expect(r.priceVsMarket).toBeNull();
    expect(r.pricePerKmRating).toBe('unknown');
    expect(r.recommendation).toContain('Brak historycznych danych dla tej trasy');
  });

  it('computes priceVsMarket against the history average', async () => {
    const { service } = makeService([
      { pricePerKm: 1.0, createdAt: new Date() },
      { pricePerKm: 2.0, createdAt: new Date() },
    ]); // srednia 1.5
    const r = await evaluate(service, { ...baseOffer, pricePerKm: 3.0 });

    expect(r.routePopularity).toBe(2);
    expect(r.priceVsMarket).toBe(100); // (3 - 1.5) / 1.5 * 100
    expect(r.pricePerKmRating).toBe('above');
  });

  it('rounds priceVsMarket to one decimal place', async () => {
    const { service } = makeService([{ pricePerKm: 3, createdAt: new Date() }]);
    const r = await evaluate(service, { ...baseOffer, pricePerKm: 2 });
    expect(r.priceVsMarket).toBe(-33.3);
  });

  describe('progi pricePerKmRating (+/-5%)', () => {
    const cases: Array<[number, string]> = [
      [1.2, 'above'],    // +20%
      [1.06, 'above'],   // +6%
      [1.04, 'at'],      // +4%
      [1.0, 'at'],
      [0.96, 'at'],      // -4%
      [0.94, 'below'],   // -6%
      [0.8, 'below'],    // -20%
    ];
    it.each(cases)('rate %p with an average of 1.0 -> %s', async (ppkm, expected) => {
      const { service } = makeService([{ pricePerKm: 1.0, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: ppkm });
      expect(r.pricePerKmRating).toBe(expected);
    });

    it('known flaw: exactly +/-5% lands outside "at" because of floating-point error', async () => {
      // The code uses `> 5` / `< -5`, so exactly 5% should be "at".
      // (1.05 - 1) / 1 * 100 === 5.000000000000004, so the condition is met.
      const { service } = makeService([{ pricePerKm: 1.0, createdAt: new Date() }]);
      expect((await evaluate(service, { ...baseOffer, pricePerKm: 1.05 })).pricePerKmRating).toBe('above');
      expect((await evaluate(service, { ...baseOffer, pricePerKm: 0.95 })).pricePerKmRating).toBe('below');
    });
  });

  describe('progi marginRating', () => {
    it.each([
      [30, 'excellent'],
      [20.1, 'excellent'],
      [20, 'good'],
      [10, 'good'],
      [9.9, 'fair'],
      [5, 'fair'],
      [4.9, 'poor'],
      [-10, 'poor'],
    ])('margin %p%% -> %s', async (margin, expected) => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, profitMarginPercent: margin });
      expect(r.marginRating).toBe(expected);
    });
  });

  it('builds the route and a timestamp', async () => {
    const { service } = makeService([]);
    const r = await evaluate(service, baseOffer);
    expect(r.offerId).toBe('off-1');
    expect(r.route).toBe('PL→DE');
    expect(new Date(r.calculatedAt).toString()).not.toBe('Invalid Date');
  });

  it('leaves the evaluated offer itself out of the history (query with id: not)', async () => {
    const { service, prisma } = makeService([]);
    await evaluate(service, baseOffer);
    expect(prisma.offer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'comp-1',
          pickupCountry: 'PL',
          deliveryCountry: 'DE',
          id: { not: 'off-1' },
        }),
      }),
    );
  });

  describe('tekst rekomendacji', () => {
    it.each([
      [30, 'Zdecydowanie warto zaakceptować'],
      [12, 'Warto zaakceptować'],
      [7, 'Rozważ negocjację lepszej ceny'],
      [-5, 'Słabe warunki'],
    ])('margin %p%% ends with the recommendation "%s"', async (margin, fragment) => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, profitMarginPercent: margin });
      expect(r.recommendation).toContain(fragment);
    });

    it.each([
      [12, 'Trasa popularna'],
      [5, 'Trasa umiarkowanie znana'],
      [1, 'Trasa niszowa'],
    ])('%p offers in history -> "%s"', async (count, fragment) => {
      const hist = Array.from({ length: count }, () => ({ pricePerKm: 2, createdAt: new Date() }));
      const { service } = makeService(hist);
      const r = await evaluate(service, baseOffer);
      expect(r.recommendation).toContain(fragment);
    });
  });

  describe('zero values are numbers, not missing data', () => {
    it('a margin of 0% is scored as zero, not as a missing margin', async () => {
      const { service } = makeService([]);
      const zero = await evaluate(service, { ...baseOffer, profitMarginPercent: 0 });
      const missing = await evaluate(service, { ...baseOffer, profitMarginPercent: null });

      // 0 passes `!= null`, so it reaches the branch `margin >= 0 -> 3`
      expect(zero.score).toBe(3);
      // missing data still gives a neutral 5 — two different results
      expect(missing.score).toBe(5);
      expect(zero.score).not.toBe(missing.score);
      expect((service as any).calcScore(0, null)).toBe(zero.score);
    });

    it('a margin of 0% appears in the recommendation text', async () => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, profitMarginPercent: 0 });

      expect(r.recommendation).toContain('Marża 0.0%');
      expect(r.recommendation).toContain('bardzo słaba opłacalność');
      expect(r.recommendation).toContain('Słabe warunki');
    });

    it('a price of 0 is shown as a zero amount, not as a missing price', async () => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, price: 0 });

      expect(r.recommendation).toContain('za 0 EUR');
      expect(r.recommendation).not.toContain('brak ceny');
    });

    it('a missing price is still described as missing', async () => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, price: null });

      expect(r.recommendation).toContain('brak ceny');
    });

    it('a rate of 0 EUR/km is compared with the average, not treated as missing', async () => {
      const { service } = makeService([{ pricePerKm: 2, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: 0 });

      expect(r.priceVsMarket).toBe(-100); // (0 - 2) / 2 * 100
      expect(r.pricePerKmRating).toBe('below');
      expect(r.recommendation).toContain('0.00 EUR/km'); // the offer's currency, not a hard-coded €/km
    });

    it('a missing rate still turns off the comparison with the average', async () => {
      const { service } = makeService([{ pricePerKm: 2, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: null });

      expect(r.priceVsMarket).toBeNull();
      expect(r.pricePerKmRating).toBe('unknown');
      expect(r.recommendation).toContain('brak stawki');
    });
  });

  describe('division by zero is a separate condition from missing data', () => {
    it('a zero average produces neither Infinity nor NaN', async () => {
      const { service } = makeService([{ pricePerKm: 0, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: 1 });

      expect(r.priceVsMarket).toBeNull();
      expect(r.pricePerKmRating).toBe('unknown');
    });

    it('a zero average does not block the rest of the evaluation', async () => {
      const { service } = makeService([{ pricePerKm: 0, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: 1, profitMarginPercent: 18 });

      expect(r.routePopularity).toBe(1);
      expect(r.marginRating).toBe('good');
      expect(Number.isFinite(r.score)).toBe(true);
    });

    it('a non-zero average gives a normal comparison', async () => {
      const { service } = makeService([{ pricePerKm: 1, createdAt: new Date() }]);
      const r = await evaluate(service, { ...baseOffer, pricePerKm: 2 });

      expect(r.priceVsMarket).toBe(100);
    });
  });

  describe('known flaw: marginRating disagrees with the recommendation text', () => {
    it('a margin of 12% is rated "good" while the text calls it average', async () => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, profitMarginPercent: 12 });
      expect(r.marginRating).toBe('good');
      expect(r.recommendation).toContain('przeciętna opłacalność');
    });

    it('a margin of 7% is rated "fair" while the text calls it poor', async () => {
      const { service } = makeService([]);
      const r = await evaluate(service, { ...baseOffer, profitMarginPercent: 7 });
      expect(r.marginRating).toBe('fair');
      expect(r.recommendation).toContain('słaba opłacalność');
    });
  });
});

describe('AiEvaluationService — batchEvaluate', () => {
  it('sorts results by score, highest first', async () => {
    const offers = [
      { ...baseOffer, id: 'a', profitMarginPercent: 2 },
      { ...baseOffer, id: 'b', profitMarginPercent: 30 },
      { ...baseOffer, id: 'c', profitMarginPercent: 12 },
    ];
    const prisma: any = {
      offer: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(offers)
          .mockResolvedValue([]),
      },
    };
    const queue: any = { enqueue: (fn: () => any) => Promise.resolve(fn()) };
    const service = new AiEvaluationService(prisma, queue);

    const results = await service.batchEvaluate('comp-1');
    expect(results.map((r) => r.offerId)).toEqual(['b', 'c', 'a']);
    expect(results.map((r) => r.score)).toEqual([9, 7, 3]);
  });
});

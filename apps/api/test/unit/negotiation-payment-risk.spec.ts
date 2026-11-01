/**
 * Negotiation — the "Ryzyko płatności" (payment risk) argument.
 *
 * Characterization test written before the rule moved to the shared
 * counterpartyRisk() (common/counterparty-risk.ts). It pins the behaviour: the
 * argument appears only with paymentRating ≤ 2 — low reliability and the
 * blacklist do NOT trigger it (those criteria are used on the LTL card).
 */
import { NegotiationService } from '../../src/negotiation/negotiation.service';

const contractor = (over: Record<string, any> = {}) => ({
  name: 'Kontrahent',
  totalOrders: 5,
  recentOrders30d: 0,
  recentOrders90d: 1,
  avgRate: null,
  paymentRating: null,
  reliabilityScore: null,
  avgPaymentDays: null,
  isRegular: false,
  priceVsMarket: 'market' as const,
  priceVsMarketPct: 0,
  ...over,
});

const price = { avgPrice: 0, optimalPrice: 0, marketTrend: 'stable', trendPercentChange: 0 } as any;
const offer = { price: null, currency: 'PLN', pickupCity: 'A', deliveryCity: 'B', pickupDate: null };
const tollCost = { source: 'none' } as any;

function paymentArgs(c: ReturnType<typeof contractor> & Record<string, any>) {
  const service = new NegotiationService({} as any);
  // An unknown cost — this is only about the payment risk argument.
  const cost = { ok: false, messages: [{ code: 'OFFER_COST_NO_DISTANCE' }] };
  const args = (service as any).getNegotiationArguments(offer, null, price, c, tollCost, cost);
  return args.filter((a: any) => a.title === 'Ryzyko płatności');
}

describe('negotiation — payment risk argument (only the PAYMENT criterion of counterpartyRisk)', () => {
  it.each([[1], [2]])('paymentRating %i → argument with the rating in the text', rating => {
    const args = paymentArgs(contractor({ paymentRating: rating }));
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({ icon: '⚠️', type: 'cost', strength: 8 });
    expect(args[0].text).toContain(`(${rating}/5)`);
  });

  it.each([[3], [5], [null]])('paymentRating %p → no argument', rating => {
    expect(paymentArgs(contractor({ paymentRating: rating }))).toHaveLength(0);
  });

  it('low reliability or blacklist alone → no payment argument', () => {
    expect(paymentArgs(contractor({ reliabilityScore: 5, isBlacklisted: true }))).toHaveLength(0);
  });
});

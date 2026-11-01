/**
 * counterpartyRisk — the shared definition of counterparty risk (LTL card, negotiation).
 */
import { counterpartyRisk } from '../../src/common/counterparty-risk';

describe('counterpartyRisk', () => {
  it('no contractor or no data → no risk (missing data is not a risk)', () => {
    expect(counterpartyRisk(null)).toEqual([]);
    expect(counterpartyRisk({})).toEqual([]);
    expect(counterpartyRisk({ isBlacklisted: false, paymentRating: null, reliabilityScore: null })).toEqual([]);
  });

  it.each([
    [{ isBlacklisted: true }, ['BLACKLIST']],
    [{ paymentRating: 2 }, ['PAYMENT']],
    [{ paymentRating: 3 }, []],
    [{ reliabilityScore: 39 }, ['RELIABILITY']],
    [{ reliabilityScore: 40 }, []],
    [{ reliabilityScore: 0 }, ['RELIABILITY']], // 0 is the worst score, not a missing one
    [{ paymentRating: 0 }, ['PAYMENT']],
    [{ isBlacklisted: true, paymentRating: 1, reliabilityScore: 10 }, ['BLACKLIST', 'PAYMENT', 'RELIABILITY']],
  ])('%p → %p', (input, expected) => {
    expect(counterpartyRisk(input)).toEqual(expected);
  });
});

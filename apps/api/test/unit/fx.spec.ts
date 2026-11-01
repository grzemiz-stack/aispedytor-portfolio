/**
 * common/fx.ts — the only source of exchange rates (docs/decisions.md §4).
 */
import { convert } from '../../src/common/fx';

describe('fx — static rates', () => {
  it('same currency: no conversion, no code', () => {
    expect(convert(1200, 'PLN', 'PLN')).toEqual({ ok: true, amount: 1200, rate: 1, messages: [] });
  });

  it('EUR → PLN: 1 EUR = 1 / 0.23 PLN, with FX_RATE_STATIC', () => {
    const r = convert(1200, 'EUR', 'PLN');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount).toBeCloseTo(5217.39, 2);
    expect(r.messages).toEqual([{ code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'PLN', rate: 4.3478 } }]);
  });

  it('GBP → PLN: 1.15 / 0.23 = 5', () => {
    const r = convert(1150, 'GBP', 'PLN');
    expect(r.ok && r.amount).toBeCloseTo(5750, 6);
  });

  it('PLN → GBP is the inverse', () => {
    const r = convert(5750, 'PLN', 'GBP');
    expect(r.ok && r.amount).toBeCloseTo(1150, 6);
  });

  it('currency codes from imports: trimmed and upper-cased', () => {
    const r = convert(100, ' eur ', 'pln');
    expect(r.ok && r.messages[0].params).toMatchObject({ from: 'EUR', to: 'PLN' });
  });

  it.each([['USD', 'PLN'], ['PLN', 'USD'], ['', 'PLN']])(
    '%s → %s: no rate → CURRENCY_CONVERSION_UNAVAILABLE, no amount',
    (from, to) => {
      expect(convert(100, from, to)).toEqual({
        ok: false,
        messages: [{ code: 'CURRENCY_CONVERSION_UNAVAILABLE', params: { from: from.trim().toUpperCase(), to } }],
      });
    },
  );
});

/**
 * Test-only toll provider: a fixed rate per km for each country.
 *
 * NOT a toll calculation — the rates are arbitrary numbers chosen for tests.
 * It exists to show that, once a provider is registered, the planner, the
 * LTL ranking and negotiation count the toll it returns. It lives in `test/`
 * and is never registered in the application.
 */
import { TollProviderError, type TollProvider, type TollQuote, type TollRequest } from '../../src/tolls/toll-provider';

export const FAKE_RATES: Readonly<Record<string, { perKm: number; currency: string }>> = {
  PL: { perKm: 0.4, currency: 'PLN' },
  DE: { perKm: 0.2, currency: 'EUR' },
  FR: { perKm: 0.25, currency: 'EUR' },
};

export class FixedRateTollProvider implements TollProvider {
  readonly calls: TollRequest[] = [];

  constructor(private readonly options: { failWith?: string; rates?: typeof FAKE_RATES } = {}) {}

  async quote(request: TollRequest): Promise<TollQuote> {
    this.calls.push(request);
    if (this.options.failWith) throw new TollProviderError(this.options.failWith);
    const rates = this.options.rates ?? FAKE_RATES;
    const items = request.route.countries
      .filter(c => rates[c.countryCode] && c.distanceKm > 0)
      .map(c => ({
        countryCode: c.countryCode,
        amount: Math.round(c.distanceKm * rates[c.countryCode].perKm * 100) / 100,
        currency: rates[c.countryCode].currency,
        system: `fake-${c.countryCode}`,
      }));
    return { source: 'fake-fixed-rate', items };
  }
}

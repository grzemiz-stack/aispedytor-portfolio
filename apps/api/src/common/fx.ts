/**
 * Currency conversion — the only source of exchange rates in the application
 * (docs/decisions.md §4).
 *
 * Used by: the LTL ranking, dashboard and analytics (common/money.ts), the
 * route planner (fuel, toll amounts from the provider — src/tolls, margin) and
 * negotiation (including the rate for the panel's slider — the front end has
 * no rate of its own). The rates are static.
 *
 * Switching to live rates (e.g. the Polish central bank, NBP) means replacing
 * only the rate source in this file; callers would then get a different
 * source code instead of `FX_RATE_STATIC`.
 */
import { msg, type PlanMessage } from './plan-messages';

/** How many EUR per unit of the currency. */
const RATES_TO_EUR: Readonly<Record<string, number>> = {
  EUR: 1.0,
  PLN: 0.23,
  CZK: 0.040,
  HUF: 0.0026,
  CHF: 1.05,
  GBP: 1.15,
  DKK: 0.134,
  SEK: 0.088,
  NOK: 0.086,
  BGN: 0.51,
  RON: 0.20,
};


export type FxResult =
  | {
      ok: true;
      amount: number;
      /** How many `to` per unit of `from`; 1 for the same currency. */
      rate: number;
      /** `FX_RATE_STATIC` when converted; an empty list for the same currency. */
      messages: PlanMessage[];
    }
  | {
      ok: false;
      /** `CURRENCY_CONVERSION_UNAVAILABLE {from, to}` — not zero, not a guess. */
      messages: PlanMessage[];
    };

/**
 * `amount` in `from` converted to `to`. A currency not in the table → `ok: false`
 * with a code; the caller decides what to do (ranking: the offer goes to the end).
 * Currency codes are compared after trim + upper-case — imported offers vary.
 */
export function convert(amount: number, from: string, to: string): FxResult {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return { ok: true, amount, rate: 1, messages: [] };

  const fromEur = RATES_TO_EUR[f];
  const toEur = RATES_TO_EUR[t];
  if (fromEur === undefined || toEur === undefined) {
    return { ok: false, messages: [msg('CURRENCY_CONVERSION_UNAVAILABLE', { from: f, to: t })] };
  }
  const rate = fromEur / toEur;
  return {
    ok: true,
    amount: amount * rate,
    rate,
    messages: [msg('FX_RATE_STATIC', { from: f, to: t, rate: Math.round(rate * 10000) / 10000 })],
  };
}

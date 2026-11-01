import { messagesToText, type Language, type PlanMessage } from './plan-messages';

/**
 * Dashboard and analytics amounts — the currency comes from the API, not the screen.
 *
 * The API converts totals and averages to the company currency
 * (api/src/common/money.ts) and adds `money`: the currency, the exchange-rate
 * codes and the number of offers without a rate. The screen must not append a
 * fixed "EUR" / "€" to totals of mixed currencies.
 */
export interface MoneySummary {
  currency: string;
  codes: PlanMessage[];
  unconverted: number;
}

/** "10 848 PLN"; no amount — a dash. */
export function amountLabel(value: number | null | undefined, currency: string | undefined): string {
  if (value === null || value === undefined || !currency) return '—';
  return `${Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} ${currency}`;
}

/** "8.14 PLN/km"; no value — a dash. */
export function perKmLabel(value: number | string | null | undefined, currency: string | undefined): string {
  if (value === null || value === undefined || value === '' || !currency) return '—';
  return `${Number(value).toFixed(2)} ${currency}/km`;
}

/**
 * The rate entered in the form vs the route average from the API — only in the
 * same currency. The average is in the company currency; an offer in another
 * currency has nothing to compare with in the front end (only the API knows the
 * exchange rate), so there is no comparison.
 */
export function comparablePerKm(
  entered: number | null, enteredCurrency: string,
  average: number | null, averageCurrency: string | undefined,
): { entered: number; average: number } | null {
  if (!entered || !average || enteredCurrency !== averageCurrency) return null;
  return { entered, average };
}

/** Sentences under the amounts: fixed exchange rate, offers without a rate left out. */
export function moneyNotes(money: MoneySummary | undefined, language: Language = 'pl'): string[] {
  return messagesToText(money?.codes ?? [], language);
}

/**
 * Currencies in which a company can keep its cost per km and the LTL ranking.
 *
 * The same list is in the CHECK on `companies.cost_currency` — the test
 * company-currency-check.spec.ts compares the two.
 */
export const COMPANY_CURRENCIES = ['PLN', 'EUR', 'GBP'] as const;

export type CompanyCurrency = (typeof COMPANY_CURRENCIES)[number];

/**
 * Euro-area member states (as of 2026-10-01, Bulgaria since 2026-01-01).
 * Members only — countries that use the euro without membership
 * (Montenegro, Kosovo, Andorra, Monaco…) get PLN like the rest of the world;
 * the company changes the currency itself in its settings (docs/decisions.md §3).
 *
 * The same list is in the backfill of migration 20261001090000 — the test
 * company-currency-check.spec.ts checks that.
 */
export const EUROZONE_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
] as const;

/**
 * Currency of a new company from its country: GB → GBP, euro area → EUR, rest → PLN.
 * A country whose currency is not in the list (e.g. CH, CZ) also gets PLN.
 * The country is free text from registration, so it is compared after trim + upper-case.
 */
export function currencyForCountry(country: string | null | undefined): CompanyCurrency {
  const code = (country ?? '').trim().toUpperCase();
  if (code === 'GB') return 'GBP';
  if ((EUROZONE_COUNTRIES as readonly string[]).includes(code)) return 'EUR';
  return 'PLN';
}

import { type Language } from './plan-messages';
import { apiErrorText as apiErrorTextBase } from './api-error';

/**
 * The "Koszt kilometra" (cost per km) form in the company settings — logic without React.
 *
 * Only CHANGED fields are sent. A currency change alone, with a cost already
 * set, therefore goes without the cost, and the API answers 400
 * COMPANY_CURRENCY_CHANGE_WITHOUT_COST — otherwise 4.20 PLN would silently
 * become 4.20 GBP.
 */

export const COMPANY_CURRENCIES = ['PLN', 'EUR', 'GBP'] as const;

export interface CompanyCost {
  costPerKm: number | null;
  costCurrency: string;
}

/** The API sends the amount as a string (Decimal) — "4.2" → 4.2; missing → null. */
export function costFromApi(company: { costPerKm?: unknown; costCurrency?: unknown }): CompanyCost {
  const n = company.costPerKm == null ? null : Number(company.costPerKm);
  return {
    costPerKm: n != null && Number.isFinite(n) ? n : null,
    costCurrency: typeof company.costCurrency === 'string' ? company.costCurrency : 'PLN',
  };
}

/**
 * Text field → amount. An empty string = no cost (`null`). Comma or dot as the
 * separator. Text that is not a number → `undefined` (the form shows an error
 * and sends nothing); the API checks the rest.
 */
export function parseCostPerKm(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

/** PATCH body with the fields that changed; `null` = nothing to send. */
export function costPatch(current: CompanyCost, next: CompanyCost): Partial<CompanyCost> | null {
  const body: Partial<CompanyCost> = {};
  if (next.costPerKm !== current.costPerKm) body.costPerKm = next.costPerKm;
  if (next.costCurrency !== current.costCurrency) body.costCurrency = next.costCurrency;
  return Object.keys(body).length > 0 ? body : null;
}

/** API error → a sentence (lib/api-error.ts), with the cost form's fallback message. */
export function apiErrorText(data: unknown, language: Language = 'pl'): string {
  return apiErrorTextBase(
    data,
    language === 'pl' ? 'Nie udało się zapisać kosztu kilometra.' : 'Could not save the cost per km.',
    language,
  );
}

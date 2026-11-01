import type { Language } from './plan-messages';

/**
 * Number and date formatting that depends on the interface language.
 *
 * One place, because otherwise every screen hardcodes `'pl-PL'` and switching
 * the language would change the sentences but not the numbers.
 */

export const LOCALE: Record<Language, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
};

export const localeFor = (language: Language): string => LOCALE[language] ?? LOCALE.pl;

/** A missing date is shown as a dash, not as blank — so the field is visibly there. */
export const NO_DATE = '—';

/** Date only: 28.09.2026 / 28/09/2026. */
export function formatDate(iso: string | null | undefined, language: Language): string {
  if (!iso) return NO_DATE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_DATE;
  return d.toLocaleDateString(localeFor(language), {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * Weight in kilograms with the thousands separator OF THE LANGUAGE.
 *
 * Grouped by hand, not with `toLocaleString`: that depends on which ICU data
 * Node has on the machine, so the same number can come out differently
 * locally and on the server — and the tests would depend on the environment.
 *
 * Polish groups from five digits ("3000", but "28 000") with a non-breaking
 * space, so the number does not break at the end of a line. English groups
 * from four digits, with a comma ("3,000", "28,000").
 */
export function formatKg(value: unknown, language: Language = 'pl'): string {
  return `${groupThousands(value, language)} kg`;
}

/** A factor (e.g. straight line → road): "1,25" / "1.25". */
export function formatFactor(value: unknown, language: Language = 'pl'): string {
  const n = Number(value);
  const text = String(Number.isFinite(n) ? n : 0);
  return language === 'pl' ? text.replace('.', ',') : text;
}

/**
 * Temperature range of an offer: "od −20 do −18 °C", "od 2 °C", "do 6 °C"
 * (English: "from … to …"). An empty string when the offer gives neither bound.
 */
export function formatTemperatureRange(min: unknown, max: unknown, language: Language = 'pl'): string {
  const t = (v: unknown) => `${formatFactor(v, language).replace('-', '\u2212')} °C`;
  const hasMin = min != null && min !== '';
  const hasMax = max != null && max !== '';
  const [from, to] = language === 'pl' ? ['od', 'do'] : ['from', 'to'];
  if (hasMin && hasMax) return `${from} ${t(min)} ${to} ${t(max)}`;
  if (hasMin) return `${from} ${t(min)}`;
  if (hasMax) return `${to} ${t(max)}`;
  return '';
}

/**
 * Amount in whole units with the currency code: "3243 PLN", "−1 257 PLN" /
 * "3,243 PLN". No minor units — the ranking compares hundreds and thousands,
 * and the exact value is in the API. Typographic minus, as in temperatures.
 */
export function formatMoney(value: unknown, currency: string, language: Language = 'pl'): string {
  return `${groupThousands(value, language).replace('-', '\u2212')} ${currency}`;
}

/** A whole number with the thousands separator of the language (see formatKg). */
function groupThousands(value: unknown, language: Language): string {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));

  const group = (separator: string) =>
    digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

  const grouped = language === 'en'
    ? group(',')
    : (digits.length > 4 ? group(' ') : digits);

  return `${sign}${grouped}`;
}

/** Weight in tonnes with one decimal place: "40,5 t" / "40.5 t". */
export function formatTonnes(value: unknown, language: Language = 'pl'): string {
  const n = Number(value) / 1000;
  const text = (Number.isFinite(n) ? n : 0).toFixed(1);
  return `${language === 'pl' ? text.replace('.', ',') : text} t`;
}

/** Metres with one decimal place. */
export function formatMeters(value: unknown, language: Language = 'pl'): string {
  const n = Number(value);
  const text = (Number.isFinite(n) ? n : 0).toFixed(1);
  return `${language === 'pl' ? text.replace('.', ',') : text} m`;
}

/**
 * The list from a paginated API response: `{ data: [...], meta: {...} }`.
 *
 * API lists (offers, e-mail inbox, fleet…) return `buildPaginatedResponse`,
 * not a bare array. A screen that takes `res.data` for an array fails on
 * `[...object]` or shows nothing — and with an empty `catch` the error
 * vanishes. Any other shape is an error with a message, not a silent empty
 * list.
 */
export function pageItems<T>(body: unknown): T[] {
  const list = (body as { data?: unknown } | null)?.data;
  if (Array.isArray(list)) return list as T[];
  throw new Error('Nieoczekiwana odpowiedź API: brak listy w polu „data”.');
}

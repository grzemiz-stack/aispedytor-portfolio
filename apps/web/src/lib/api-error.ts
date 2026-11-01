import { messageText, type Language } from './plan-messages';

/**
 * API error → a sentence for the user.
 *
 * A message code (`{ code, params }`) goes through the PL/EN dictionary; DTO
 * validation errors come as a list of sentences; a plain `message` is shown
 * as is. This keeps raw codes (e.g. "ROUTE_GEOCODING_FAILED") off the screen.
 */
export function apiErrorText(data: unknown, fallback: string, language: Language = 'pl'): string {
  const d = data as { code?: unknown; params?: Record<string, string | number | boolean>; message?: unknown } | null;
  if (d && typeof d.code === 'string') return messageText({ code: d.code, params: d.params }, language);
  if (d && Array.isArray(d.message)) return d.message.join(' ');
  if (d && typeof d.message === 'string') return d.message;
  return fallback;
}

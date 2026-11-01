/**
 * Shared Sentry options for the browser, the Next server and Edge
 * (docs/decisions.md §8). Pure functions without the SDK — the file can be
 * imported always, also without a DSN (it does not pull the SDK into the
 * bundle).
 *
 * - `scrubEvent`: no request body, headers, cookies or query; addresses
 *   without their query — in the event, the trace data and the spans
 *   (breadcrumbs are cleaned by `scrubBreadcrumb` when recorded —
 *   `beforeBreadcrumb`);
 * - `scrubBreadcrumb`: a breadcrumb (fetch/xhr/navigation) with its address
 *   without the query;
 * - console breadcrumbs are OFF in the configs, not cleaned here;
 * - `REPLAY_PRIVACY`: Replay masks all text and inputs, blocks media.
 */
type Data = Record<string, unknown> | undefined;

/** Data keys with a query — their values are dropped whole. */
const QUERY_KEYS = /query/i;
/** Data keys with an address — the address stays, without its query. */
const URL_KEYS = /(^|\.)(url|to|from|target)(\.|$)|url\.full/i;

const withoutQuery = (url: string): string => url.split('?')[0];

function scrubData(data: Data): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data)) {
    if (QUERY_KEYS.test(key)) delete data[key];
    else if (typeof value === 'string' && URL_KEYS.test(key)) data[key] = withoutQuery(value);
  }
}

interface ScrubbableEvent {
  request?: { url?: string; data?: unknown; headers?: unknown; cookies?: unknown; query_string?: unknown };
  contexts?: { trace?: { data?: Data } };
  spans?: { data?: Data }[];
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  scrubData(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) scrubData(span.data);
  return event;
}

export function scrubBreadcrumb<T extends { data?: Data }>(crumb: T): T {
  scrubData(crumb.data);
  return crumb;
}

/** Server and Edge integrations: the defaults without console breadcrumbs. */
export function withoutConsole<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((i) => i.name !== 'Console');
}

export const REPLAY_PRIVACY = { maskAllText: true, maskAllInputs: true, blockAllMedia: true } as const;

/**
 * Session Replay is off by default — 0 % of sessions and 0 % of sessions with
 * an error: recording the user's screen is a deployment decision (a privacy
 * notice), not a default. To turn it on, set the fractions here (e.g. 0.1 and
 * 1.0) and rebuild the web app; the recording still masks all text and inputs
 * (REPLAY_PRIVACY).
 */
export const REPLAY_RATES = { replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 } as const;

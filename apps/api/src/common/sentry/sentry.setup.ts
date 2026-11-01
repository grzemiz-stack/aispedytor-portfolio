import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';

/** Span data keys that carry the request query — their values are dropped whole. */
const QUERY_KEYS = /query/i;
/** Span data keys with an address — the address stays, without its query. */
const URL_KEYS = /(^|\.)(url|target)(\.|$)|url\.full/i;

const withoutQuery = (url: string): string => url.split('?')[0];

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data)) {
    if (QUERY_KEYS.test(key)) delete data[key];
    else if (typeof value === 'string' && URL_KEYS.test(key)) data[key] = withoutQuery(value);
  }
}

/**
 * Every event and transaction loses what came with the request: the body,
 * the headers (the Bearer token), cookies, the query (the OAuth code) — also
 * from addresses and span data (docs/decisions.md §8). The method and the path
 * stay. The names of the body fields are added by our filter
 * (`sentry-exception.filter.ts`).
 */
export function scrubRequest<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  scrubData(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  for (const span of event.spans ?? []) scrubData(span.data as Record<string, unknown> | undefined);
  return event;
}

/** Breadcrumbs: the query of outgoing requests (e.g. the Nominatim address) is dropped when recorded. */
export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  scrubData(crumb.data);
  return crumb;
}

/** `overrides.tracesSampleRate` — for the test on the real SDK (1, no sampling). */
export function initSentry(overrides: { tracesSampleRate?: number } = {}) {
  const logger = new Logger('Sentry');
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn('⚠️  SENTRY_DSN not set — Sentry disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: overrides.tracesSampleRate ?? 0.2,
    // `sendDefaultPii: false` alone is NOT enough: SDK v10 still attaches the
    // request body, headers, cookies and query (checked on the real SDK —
    // test/unit/sentry-real-sdk.spec.ts). So bodies are not recorded at all
    // and `scrubRequest` cleans the rest before sending.
    sendDefaultPii: false,
    // Console breadcrumbs are OFF (the Console integration is dropped), not
    // cleaned: a console line can carry anything. Http — ours, without bodies.
    integrations: (defaults) => [
      ...defaults.filter((i) => i.name !== 'Console' && i.name !== 'Http'),
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
    ],
    beforeBreadcrumb: scrubBreadcrumb,
    ignoreErrors: [
      'UnauthorizedException',
      'NotFoundException',
    ],
    beforeSend(event) {
      const status = event.contexts?.response?.status_code as number | undefined;
      if (status === 401 || status === 404) return null;
      return scrubRequest(event);
    },
    beforeSendTransaction(event) {
      return scrubRequest(event);
    },
  });

  logger.log('✅ Sentry initialized');
}

export { Sentry };

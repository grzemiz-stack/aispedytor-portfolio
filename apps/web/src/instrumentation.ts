/**
 * Sentry on the Next server side (Next 15, Sentry 10).
 *
 * Next calls `register()` once at server start — separately for the Node
 * and Edge runtimes. Before, the Sentry webpack plugin injected
 * `sentry.server.config.ts` and `sentry.edge.config.ts` into the server
 * bundles (with a DSN, through `withSentryConfig`) — server errors did reach
 * Sentry (checked live). The build warned because that layout is deprecated:
 * Sentry 10 wants an instrumentation file, and the old way does not work with
 * Turbopack and goes away in v11. This file is the move to the supported
 * layout, not a fix for missing reports. Without `NEXT_PUBLIC_SENTRY_DSN` the
 * configs initialise nothing and `onRequestError` sends nothing.
 *
 * The file lives in `src/` because `app/` is there — Next looks for it next
 * to the routes directory.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

/** Server rendering, route and server component errors — to Sentry. */
export const onRequestError = Sentry.captureRequestError;

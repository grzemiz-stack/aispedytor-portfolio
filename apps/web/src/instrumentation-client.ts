/**
 * Sentry in the browser (Next 15: `instrumentation-client.ts` instead of
 * `sentry.client.config.ts`). Next always loads this file before the app
 * code, also without `withSentryConfig`.
 *
 * Every SDK use sits under a direct check on
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` (not through a variable): Next inlines
 * the value at build time, so without a DSN the minifier drops those branches
 * and the SDK import (a side-effect-free package) leaves the bundle.
 * Measured: shared page code 103 kB without and 203 kB with a DSN, as before
 * the change; a plain import without checks gave 226 kB also without a DSN,
 * `require` 434 kB with one. With a DSN the SDK starts immediately (not via
 * `import()`), so it also catches errors from the start of page load.
 */
import * as Sentry from '@sentry/nextjs';
import { REPLAY_PRIVACY, REPLAY_RATES, scrubBreadcrumb, scrubEvent } from './lib/sentry-options';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
    ...REPLAY_RATES,
    // No request data and no console breadcrumbs; Replay masks everything.
    sendDefaultPii: false,
    integrations: (defaults) => [
      ...defaults.filter((i) => i.name !== 'Breadcrumbs' && i.name !== 'Console'),
      Sentry.breadcrumbsIntegration({ console: false }),
      Sentry.replayIntegration(REPLAY_PRIVACY),
      Sentry.browserTracingIntegration(),
    ],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/** App Router navigations as the start of a transaction (tracing); nothing without a DSN. */
export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? Sentry.captureRouterTransitionStart
  : () => undefined;

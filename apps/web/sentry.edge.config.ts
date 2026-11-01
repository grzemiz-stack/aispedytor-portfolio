import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent, withoutConsole } from './src/lib/sentry-options';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
    // No request data and no console breadcrumbs.
    sendDefaultPii: false,
    integrations: withoutConsole,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

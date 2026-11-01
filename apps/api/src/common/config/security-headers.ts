import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/** The Swagger UI path (`setupSwagger`): the page loads its own scripts and styles. */
const DOCS_PATH = '/api/docs';

/**
 * Security headers (helmet; docs/decisions.md §8): no `X-Powered-By`,
 * `X-Content-Type-Options: nosniff`, HSTS (browsers apply it only over
 * https), no framing.
 *
 * The API answers JSON — CSP `default-src 'none'; frame-ancestors 'none'`.
 * Swagger UI (when on) has no CSP: its page is HTML with scripts.
 * `Cross-Origin-Resource-Policy: cross-origin` — the web app and the API may
 * be on different domains (docs/DEPLOYMENT.md).
 */
export function applySecurityHeaders(app: INestApplication): void {
  const common = { crossOriginResourcePolicy: { policy: 'cross-origin' as const } };
  const api = helmet({
    ...common,
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  const docs = helmet({ ...common, contentSecurityPolicy: false });
  app.use((req: { path?: string; url?: string }, res: unknown, next: () => void) => {
    const path = req.path ?? req.url ?? '';
    return (path.startsWith(DOCS_PATH) ? docs : api)(req as never, res as never, next);
  });
}

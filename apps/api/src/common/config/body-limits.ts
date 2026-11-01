import type { INestApplication } from '@nestjs/common';
import { json } from 'body-parser';

/**
 * Request body limits.
 *
 * Nest registers its JSON parser without options — body-parser's limit is
 * 100 kB — while the logo is base64 up to 700,000 characters (≈500 KB file,
 * `CompaniesService.uploadLogo`). A larger limit only for the logo route;
 * every other route keeps 100 kB.
 *
 * The parser added here (before `listen`) runs before Nest's, which skips a
 * body that is already parsed.
 */
export const LOGO_ROUTE = '/api/companies/me/logo';
export const LOGO_BODY_LIMIT = '1mb';

export function allowLargeLogoBody(app: INestApplication): void {
  const parse = json({ limit: LOGO_BODY_LIMIT });
  // Its own function name: Nest skips its global parser when it finds a
  // middleware named `jsonParser` (body-parser's function name) — even one
  // mounted on a single path. Without this, other routes would lose JSON.
  app.use(LOGO_ROUTE, function logoBodyParser(req: unknown, res: unknown, next: () => void) {
    return (parse as (a: unknown, b: unknown, c: () => void) => void)(req, res, next);
  });
}

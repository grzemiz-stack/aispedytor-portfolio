import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { msg } from '../plan-messages';
import { flagOn, isExplicitDevOrTest } from './node-env';

/**
 * Company registration (`POST /auth/register`) — off by default.
 *
 * Registration creates a company with its ADMIN, with no invitation. It is on
 * only with an explicit `NODE_ENV=development|test` or
 * `REGISTRATION_ENABLED=true`. The first company on a server is created by
 * `npm run company:create` (`src/cli/create-company.ts`).
 */
export function registrationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isExplicitDevOrTest(env) || flagOn(env.REGISTRATION_ENABLED);
}

/**
 * Guard of the registration route: off → 403 REGISTRATION_DISABLED. Guards run
 * before body validation, so the answer does not depend on the body and
 * nothing touches the database. The environment is read on every request.
 */
@Injectable()
export class RegistrationEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (registrationEnabled()) return true;
    const m = msg('REGISTRATION_DISABLED');
    throw new ForbiddenException({ statusCode: 403, ...m, message: m.code });
  }
}

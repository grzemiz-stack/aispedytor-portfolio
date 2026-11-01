import type { Request } from 'express';

/**
 * The shape of the user that `JwtStrategy.validate()` puts on the request.
 *
 * NOTE: this is NOT the raw token payload. The strategy consumes `payload.sub`
 * and returns the id under the name `userId` — there is NO `sub` field on
 * `req.user`. References to `user.sub` are always `undefined`; this type turns
 * them into a compile error instead of a silent undefined value.
 *
 * Source of truth: `src/auth/strategies/jwt.strategy.ts` — `validate()` returns
 * `{ userId, companyId, role, email }`. A change there requires a change here.
 */
export interface JwtUser {
  userId: string;
  companyId: string;
  role: string;
  email: string;
}

/**
 * An HTTP request after `JwtAuthGuard` — with a guaranteed `user`.
 *
 * Controllers take it as `@Req() req: AuthenticatedRequest` instead of `any`.
 */
export interface AuthenticatedRequest extends Request {
  user: JwtUser;
}

/**
 * A request that MAY be unauthenticated.
 *
 * For guards, global interceptors and filters: they also run on routes
 * without `JwtAuthGuard`, so `user` may be absent. It forces `user?.` and at
 * the same time checks the field NAMES — which is what used to break here:
 * `req.user.sub` and `req.user?.id` were always `undefined`, because the
 * contract has `userId`.
 */
export interface MaybeAuthenticatedRequest extends Request {
  user?: JwtUser;
}

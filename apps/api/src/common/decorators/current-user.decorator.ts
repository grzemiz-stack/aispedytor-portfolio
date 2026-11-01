import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser, MaybeAuthenticatedRequest } from '../types/authenticated-request';

/**
 * Takes the user from the request — the whole object or one of its fields.
 *
 * `data` is narrowed to `keyof JwtUser`, so a typo in the field name is a
 * compile error, not a silent `undefined`. That is the class of bug that let
 * `req.user.sub` and `req.user?.id` through — both always undefined.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import type { MaybeAuthenticatedRequest } from '../types/authenticated-request';

/** Field names of an object (sorted); an empty list for anything else. */
export function fieldNames(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

/**
 * Global exception filter. It replaces Nest's default filter, so it must log
 * server errors itself: every 5xx goes to the log with its stack trace,
 * always, and to Sentry as well when SENTRY_DSN is set.
 */
@Catch()
export class SentryGlobalFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      // The path without the query (`req.path`, not `req.url`): a query may
      // carry an OAuth code. Ids as in ApiLoggingInterceptor; body values never.
      const user = (req as MaybeAuthenticatedRequest).user;
      const stack = exception instanceof Error ? exception.stack ?? String(exception) : String(exception);
      this.logger.error(`${req.method} ${req.path} ${status} user:${user?.userId ?? '-'} company:${user?.companyId ?? '-'}`, stack);
    }

    // Only report 5xx to Sentry (skip 401, 404, 400 etc.)
    if (status >= 500 && process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setTag('endpoint', `${req.method} ${req.path}`);
        // `req.user` exists only after JwtAuthGuard — the filter also catches
        // unauthenticated requests, hence `?`. There is no `user.sub`: the
        // strategy consumes payload.sub and returns it as `userId`.
        const user = (req as MaybeAuthenticatedRequest).user;
        if (user) {
          scope.setUser({ id: user.userId });
          scope.setTag('company_id', user.companyId);
        }
        // Field NAMES only, never values: the body carries passwords
        // (registration, login, password change), the query e.g. the OAuth code.
        scope.setExtra('bodyFields', fieldNames(req.body));
        scope.setExtra('queryFields', fieldNames(req.query));
        Sentry.captureException(exception);
      });
    }

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };

    res.status(status).json(
      typeof message === 'string' ? { statusCode: status, message } : message,
    );
  }
}

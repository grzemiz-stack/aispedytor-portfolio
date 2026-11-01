import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import * as Sentry from '@sentry/node';
import type { Request } from 'express';
import type { MaybeAuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class SentryPerformanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!process.env.SENTRY_DSN) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        // Log slow requests (>3s) as breadcrumbs
        if (duration > 3000) {
          Sentry.withScope((scope) => {
            scope.setTag('endpoint', `${req.method} ${req.path}`);
            scope.setTag('slow_request', 'true');
            // As in the filter: `user` may be absent, and `sub` does not exist on req.user.
            const user = (req as MaybeAuthenticatedRequest).user;
            if (user) {
              scope.setUser({ id: user.userId });
              scope.setTag('company_id', user.companyId);
            }
            scope.setExtra('duration_ms', duration);
            Sentry.captureMessage(
              `Slow request: ${req.method} ${req.path} (${duration}ms)`,
              'warning',
            );
          });
        }
      }),
    );
  }
}

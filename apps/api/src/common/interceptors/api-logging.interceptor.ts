import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { MaybeAuthenticatedRequest } from '../types/authenticated-request';

const SENSITIVE_KEYS = /password|token|secret|key|authorization/i;

/**
 * The address for the log: the path as it is; of the query only the
 * parameter names stay, values → `***`. A query may carry the code and
 * `state` of the OAuth callback (`/api/integrations/transeu/callback?code=…&state=…`)
 * — they must not reach the log in plain text.
 */
export function maskQuery(url: string): string {
  const i = url.indexOf('?');
  if (i < 0) return url;
  const keys = [...new URLSearchParams(url.slice(i + 1)).keys()];
  const path = url.slice(0, i);
  return keys.length ? `${path}?${keys.map((k) => `${encodeURIComponent(k)}=***`).join('&')}` : path;
}

@Injectable()
export class ApiLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const { method } = req;
    const url = maskQuery(req.url);
    const start = Date.now();

    // `userId`, not `id` — the JwtStrategy.validate() contract has no `id` field
    // (reading `id` put `-` on every log line).
    const userId = req.user?.userId || '-';
    const companyId = req.user?.companyId || '-';

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          const ms = Date.now() - start;
          this.logger.log(
            `${method} ${url} ${res.statusCode} ${ms}ms user:${userId} company:${companyId}`,
          );
        },
        error: (error) => {
          const ms = Date.now() - start;
          const status = error?.status || 500;
          this.logger.warn(
            `${method} ${url} ${status} ${ms}ms user:${userId} company:${companyId}`,
          );
        },
      }),
    );
  }

  /**
   * Sanitize an object by replacing sensitive values with '***'.
   * Not used in logging (we don't log bodies), but exported for reuse.
   */
  static sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = '***';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = ApiLoggingInterceptor.sanitize(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

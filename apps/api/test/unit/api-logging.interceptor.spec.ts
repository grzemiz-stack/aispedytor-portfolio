/**
 * ApiLoggingInterceptor — the user id in the log line.
 *
 * Regression: the interceptor read `req.user?.id`, while the
 * `JwtStrategy.validate()` contract has the field `userId`. Every API log line
 * then had `user:-` instead of the id. The company was logged correctly, so
 * the log looked trustworthy.
 *
 * The interceptor is registered globally (main.ts), so this affected every
 * request. It was found only after `getRequest()` was typed.
 */
import { of } from 'rxjs';
import { throwError } from 'rxjs';
import { ApiLoggingInterceptor, maskQuery } from '../../src/common/interceptors/api-logging.interceptor';

/** The contract returned by JwtStrategy.validate(). */
const JWT_USER = {
  userId: 'user-123',
  companyId: 'comp-456',
  role: 'DISPATCHER',
  email: 'spedytor@firma.example.com',
};

function runInterceptor(user: Record<string, unknown> | undefined): string[] {
  const logLines: string[] = [];
  const interceptor = new ApiLoggingInterceptor();
  (interceptor as any).logger = { log: (m: string) => logLines.push(m), warn: (m: string) => logLines.push(m) };

  const context: any = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/offers', user }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  };
  const next: any = { handle: () => of({}) };

  interceptor.intercept(context, next).subscribe();
  return logLines;
}

describe('ApiLoggingInterceptor — the user id in the log line', () => {
  it('logs userId from the contract, not a dash', () => {
    const [logLine] = runInterceptor(JWT_USER);

    expect(logLine).toContain('user:user-123');
    expect(logLine).not.toContain('user:-');
  });

  it('logs companyId', () => {
    expect(runInterceptor(JWT_USER)[0]).toContain('company:comp-456');
  });

  it('an `id` field outside the contract is not used as the user id', () => {
    // If the interceptor went back to reading `id`, this test would catch it.
    const [logLine] = runInterceptor({ ...JWT_USER, id: 'NIE-TO-POLE' });

    expect(logLine).toContain('user:user-123');
    expect(logLine).not.toContain('NIE-TO-POLE');
  });

  it('an unauthenticated request logs a dash instead of throwing', () => {
    const [logLine] = runInterceptor(undefined);

    expect(logLine).toContain('user:-');
    expect(logLine).toContain('company:-');
  });
});

/**
 * The query in the log: parameter names only, values masked. The whole
 * `req.url` used to be logged, so the Trans.eu OAuth callback
 * (`?code=…&state=…`) left the code and `state` in the log on every call —
 * on the warning line after an error too.
 */
describe('ApiLoggingInterceptor — query without values', () => {
  const CODE = 'oauth-code-SECRET-123';
  const STATE = 'state-signature-SECRET-456';
  const CALLBACK = `/api/integrations/transeu/callback?code=${CODE}&state=${STATE}`;

  function lines(url: string, failing = false): string[] {
    const out: string[] = [];
    const interceptor = new ApiLoggingInterceptor();
    (interceptor as any).logger = { log: (m: string) => out.push(m), warn: (m: string) => out.push(m) };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url, user: undefined }), getResponse: () => ({ statusCode: 302 }) }),
    };
    const next: any = { handle: () => (failing ? throwError(() => ({ status: 400 })) : of({})) };
    interceptor.intercept(context, next).subscribe({ error: () => undefined });
    return out;
  }

  it.each([
    ['success', false],
    ['error (warning line)', true],
  ])('OAuth callback, %s: the code and state do not reach the log, the names stay', (_n, failing) => {
    const [line] = lines(CALLBACK, failing);
    expect(line).not.toContain(CODE);
    expect(line).not.toContain(STATE);
    expect(line).toContain('GET /api/integrations/transeu/callback?code=***&state=*** ');
  });

  it.each([
    ['no query', '/api/offers', '/api/offers'],
    ['empty query', '/api/offers?', '/api/offers'],
    ['encoded values', '/api/x?code=a%26b%3Dc', '/api/x?code=***'],
    ['a repeated key', '/api/x?a=1&a=2', '/api/x?a=***&a=***'],
    ['a key without a value', '/api/x?flag', '/api/x?flag=***'],
    ['a key with special characters', '/api/x?a%20b=1', '/api/x?a%20b=***'],
    ['ordinary filters without values too', '/api/offers?country=PL&postal=60-001', '/api/offers?country=***&postal=***'],
  ])('maskQuery: %s', (_n, url, expected) => {
    expect(maskQuery(url)).toBe(expected);
  });
});

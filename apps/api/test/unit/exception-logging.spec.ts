/**
 * Every 5xx reaches the log with its stack trace — also without Sentry.
 *
 * The global filter replaces Nest's default filter, which logged errors
 * itself; without SENTRY_DSN a 500 left only the interceptor's line
 * ("POST … 500"). Now: Logger.error with method, path, status, ids and the
 * stack trace; Sentry as well when there is a DSN. Request values (the
 * password in the body, the OAuth code in the query) never reach the log.
 */
jest.mock('@sentry/node', () => {
  const scope = { setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() };
  return { scope, captureException: jest.fn(), withScope: jest.fn((fn: (s: typeof scope) => void) => fn(scope)) };
});

import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryGlobalFilter } from '../../src/common/sentry/sentry-exception.filter';

const PASSWORD = 'Secret-Password-123!';
const OAUTH_CODE = 'oauth-code-xyz';
const captureException = (Sentry as unknown as { captureException: jest.Mock }).captureException;
let logged: jest.SpyInstance;

function run(exception: unknown, user?: { userId: string; companyId: string }) {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const req = {
    method: 'POST',
    path: '/api/auth/register',
    url: `/api/auth/register?code=${OAUTH_CODE}`,
    body: { email: 'jan@example.net', password: PASSWORD },
    query: { code: OAUTH_CODE },
    user,
  };
  const host: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  new SentryGlobalFilter().catch(exception, host);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SENTRY_DSN;
  logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe('5xx without SENTRY_DSN', () => {
  it('logged: method, path, status, ids and the stack trace; the response unchanged', () => {
    const error = new Error('boom');
    const res = run(error, { userId: 'u-1', companyId: 'c-1' });
    expect(logged.mock.calls).toEqual([['POST /api/auth/register 500 user:u-1 company:c-1', error.stack]]);
    expect(error.stack).toContain('boom');
    expect([res.status.mock.calls, res.json.mock.calls]).toEqual([[[500]], [[{ statusCode: 500, message: 'Internal server error' }]]]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('no logged-in user: "-"', () => {
    run(new Error('boom'));
    expect(logged.mock.calls[0][0]).toBe('POST /api/auth/register 500 user:- company:-');
  });

  it('an HttpException 5xx (e.g. 503) is logged too', () => {
    run(new ServiceUnavailableException('down'));
    expect(logged.mock.calls[0][0]).toBe('POST /api/auth/register 503 user:- company:-');
  });

  it('something thrown that is not an Error: logged as text', () => {
    run('plain string');
    expect(logged.mock.calls[0][1]).toBe('plain string');
  });

  it('neither the password nor the query code reaches the log', () => {
    run(new Error('boom'));
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(new RegExp(`${PASSWORD}|${OAUTH_CODE}`));
  });
});

it('5xx with SENTRY_DSN: the log and Sentry', () => {
  process.env.SENTRY_DSN = 'https://public@sentry.example/1';
  run(new Error('boom'));
  expect([logged.mock.calls.length, captureException.mock.calls.length]).toEqual([1, 1]);
  delete process.env.SENTRY_DSN;
});

it('4xx: the filter logs no error (the interceptor’s warning line stays)', () => {
  run(new BadRequestException('x'));
  expect(logged).not.toHaveBeenCalled();
});

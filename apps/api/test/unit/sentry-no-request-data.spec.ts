/**
 * No request values reach Sentry.
 *
 * Registration errors are 500s; attaching `req.body` on a 5xx would send a
 * plain-text password to Sentry. Only field names are sent. The SDK (v10)
 * collects no bodies with `sendDefaultPii: false` — and it must stay so: no
 * `dataCollection`, whose presence switches to collecting everything.
 */
jest.mock('@sentry/node', () => {
  const scope = { setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() };
  return {
    scope,
    init: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn: (s: typeof scope) => void) => fn(scope)),
    httpIntegration: jest.fn((opts: unknown) => ({ name: 'Http', opts })),
  };
});

import { BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryGlobalFilter, fieldNames } from '../../src/common/sentry/sentry-exception.filter';
import { initSentry } from '../../src/common/sentry/sentry.setup';

const sentry = Sentry as unknown as {
  scope: Record<'setTag' | 'setUser' | 'setExtra', jest.Mock>;
  init: jest.Mock;
  captureException: jest.Mock;
};

const PASSWORD = 'Tajne-Haslo-123!';
const OAUTH_CODE = 'oauth-code-xyz';

function run(exception: unknown) {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const req = {
    method: 'POST',
    path: '/api/auth/register',
    body: { email: 'jan@example.net', password: PASSWORD, companyName: 'Firma' },
    query: { code: OAUTH_CODE },
  };
  const host: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  new SentryGlobalFilter().catch(exception, host);
  return res;
}

const everythingSent = () =>
  JSON.stringify([sentry.scope.setTag.mock.calls, sentry.scope.setUser.mock.calls, sentry.scope.setExtra.mock.calls, sentry.captureException.mock.calls]);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SENTRY_DSN = 'https://public@sentry.example/1';
});
afterAll(() => {
  delete process.env.SENTRY_DSN;
});

describe('SentryGlobalFilter — 5xx', () => {
  it('reports the error without the password or the query values', () => {
    const res = run(new Error('boom'));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(everythingSent()).not.toContain(PASSWORD);
    expect(everythingSent()).not.toContain(OAUTH_CODE);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('sends only the field names', () => {
    run(new Error('boom'));

    expect(sentry.scope.setExtra.mock.calls).toEqual([
      ['bodyFields', ['companyName', 'email', 'password']],
      ['queryFields', ['code']],
    ]);
  });
});

it('4xx is not reported at all', () => {
  run(new BadRequestException('x'));
  expect(sentry.captureException).not.toHaveBeenCalled();
});

it.each([
  [{ b: 1, a: 2 }, ['a', 'b']],
  [undefined, []],
  [null, []],
  ['text', []],
  [[1, 2], []],
])('fieldNames(%p) → %p', (value, expected) => {
  expect(fieldNames(value)).toEqual(expected);
});

it('initSentry: sendDefaultPii false, no dataCollection, request bodies not recorded, events and transactions scrubbed', () => {
  initSentry();
  const options = sentry.init.mock.calls[0][0];
  expect(options.sendDefaultPii).toBe(false);
  expect(options).not.toHaveProperty('dataCollection');
  // sendDefaultPii alone is not enough — the real SDK is checked by sentry-real-sdk.spec.ts.
  // The default integrations without Console (console breadcrumbs off) and without the default Http — our Http without bodies.
  const integrations = options.integrations([{ name: 'Console' }, { name: 'Http' }, { name: 'OnUncaughtException' }]);
  expect(integrations).toEqual([{ name: 'OnUncaughtException' }, { name: 'Http', opts: { maxIncomingRequestBodySize: 'none' } }]);
  expect([typeof options.beforeSend, typeof options.beforeSendTransaction, typeof options.beforeBreadcrumb]).toEqual(['function', 'function', 'function']);
});

/**
 * No request values reach Sentry — checked on the REAL SDK.
 *
 * Before: `sendDefaultPii: false` was meant to be enough, and the guard
 * (`sentry-no-request-data.spec.ts`) replaced the SDK with a mock, so it saw
 * only our filter. The real SDK (v10) itself attaches the request body,
 * headers (the Bearer token), cookies and query to 5xx events and to sampled
 * transactions — passwords from login and registration, refresh tokens, the
 * OAuth code.
 *
 * Here: the real `initSentry` with a DSN pointing to a local receiver
 * (127.0.0.1 — the network guard lets it through), a small Nest app with our
 * filter and interceptor, `tracesSampleRate: 1`. The receiver gets the raw
 * envelopes; the test looks for sentinel values in them. First it checks that
 * envelopes with the error and the transactions arrived at all — an empty
 * inbox proves nothing.
 */
import 'reflect-metadata';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Body, Controller, Get, INestApplication, Module, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { initSentry } from '../../src/common/sentry/sentry.setup';
import { SentryGlobalFilter } from '../../src/common/sentry/sentry-exception.filter';
import { SentryPerformanceInterceptor } from '../../src/common/sentry/sentry-performance.interceptor';

// Sentinels — joined, so they never sit in the source as one string.
const PASSWORD = ['Haslo', 'Wartownik', '91'].join('-');
const REG_PASSWORD = ['Rejestracja', 'Wartownik', '92'].join('-');
const REFRESH = ['refresh', 'wartownik', 'abc123'].join('_');
const BEARER = ['jwt', 'wartownik', 'def456'].join('.');
const OAUTH_CODE = ['kod', 'oauth', 'wartownik'].join('_');
const OAUTH_STATE = ['stan', 'oauth', 'wartownik'].join('_');
const COOKIE = ['ciastko', 'wartownik'].join('_');
const OUTGOING_Q = ['adres', 'wychodzacy', 'wartownik'].join('_');
const CONSOLE_LINE = ['konsola', 'wartownik'].join('_');
const SECRETS = { PASSWORD, REG_PASSWORD, REFRESH, BEARER, OAUTH_CODE, OAUTH_STATE, COOKIE, OUTGOING_Q, CONSOLE_LINE };

/** An "outside service" (like Nominatim) — local; the route calls it with a secret in the query. */
let outside: http.Server;
let outsidePort = 0;
const callOutside = () =>
  new Promise<void>((resolve) => {
    http.get({ host: '127.0.0.1', port: outsidePort, path: `/search?q=${OUTGOING_Q}` }, (res) => { res.resume(); res.on('end', () => resolve()); });
  });

@Controller('auth')
class AuthLike {
  @Post('login') login(@Body() _b: unknown) { return { ok: true }; }
  @Post('refresh') refresh(@Body() _b: unknown) { return { ok: true }; }
  @Post('register') async register(@Body() _b: unknown) {
    // An outgoing request (a span and an http breadcrumb) and a console line (a console breadcrumb) before the error.
    await callOutside();
    console.log(`debug ${CONSOLE_LINE}`);
    throw new Error('database down');
  }
}
@Controller('integrations/transeu')
class CallbackLike {
  @Get('callback') callback(@Query() _q: unknown) { return { ok: true }; }
}
@Module({ controllers: [AuthLike, CallbackLike] })
class ProbeModule {}

const received: string[] = [];
let receiver: http.Server;
let app: INestApplication;
let port: number;
const savedDsn = process.env.SENTRY_DSN;

function call(method: string, path: string, body?: object): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${BEARER}`, cookie: `transeu_oauth=${COOKIE}` },
      },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); },
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

beforeAll(async () => {
  outside = http.createServer((_req, res) => res.end('[]'));
  await new Promise<void>((r) => outside.listen(0, '127.0.0.1', () => r()));
  outsidePort = (outside.address() as AddressInfo).port;
  receiver = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { received.push(b); res.end('{}'); });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  process.env.SENTRY_DSN = `http://public@127.0.0.1:${(receiver.address() as AddressInfo).port}/1`;
  initSentry({ tracesSampleRate: 1 });

  app = await NestFactory.create(ProbeModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new SentryGlobalFilter());
  app.useGlobalInterceptors(new SentryPerformanceInterceptor());
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;

  const codes = [
    await call('POST', '/api/auth/login', { email: 'jan@example.net', password: PASSWORD }),
    await call('POST', '/api/auth/refresh', { refreshToken: REFRESH }),
    await call('POST', '/api/auth/register', { email: 'ewa@example.net', password: REG_PASSWORD }),
    await call('GET', `/api/integrations/transeu/callback?code=${OAUTH_CODE}&state=${OAUTH_STATE}`),
  ];
  expect(codes).toEqual([201, 201, 500, 200]);
  await Sentry.flush(5000);
}, 30_000);

afterAll(async () => {
  await app?.close();
  await Sentry.close(2000);
  await new Promise((r) => receiver.close(r));
  await new Promise((r) => outside.close(r));
  if (savedDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = savedDsn;
});

it('the probe reached Sentry: an error event (the 500) and transactions for the requests', () => {
  const all = received.join('\n');
  expect(all).toMatch(/"type":"event"/);
  expect(all).toMatch(/"type":"transaction"/);
  // Each of the four requests as a transaction — also those with secrets in the body and the query.
  for (const route of ['/api/auth/login', '/api/auth/refresh', '/api/auth/register', '/api/integrations/transeu/callback']) {
    expect([route, all.includes(route)]).toEqual([route, true]);
  }
});

it('the outgoing request is in the trace and the breadcrumbs (span op http.client, breadcrumb category http) — scrubbed, not dropped', () => {
  const all = received.join('\n');
  expect(all).toContain(`127.0.0.1:${outsidePort}/search`);
  expect(all).toMatch(/"op":"http\.client"/);
  expect(all).toMatch(/"category":"http"/);
});

it('console breadcrumbs are off (no console category at all)', () => {
  expect(received.join('\n')).not.toMatch(/"category":"console"/);
});

it.each(Object.entries(SECRETS))('no envelope carries %s', (_name, secret) => {
  expect(received.filter((env) => env.includes(secret)).length).toBe(0);
});

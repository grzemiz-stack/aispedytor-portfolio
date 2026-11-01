/**
 * API security headers.
 *
 * Before: no `helmet` — `X-Powered-By: Express`, no CSP, HSTS,
 * `X-Content-Type-Options` or framing protection.
 * Now: `applySecurityHeaders` (helmet) in `main.ts`. The API answers JSON,
 * so CSP `default-src 'none'; frame-ancestors 'none'`. Swagger UI
 * (`/api/docs`, when on) gets the same headers except CSP — its page loads
 * its own scripts and styles.
 *
 * Tested over HTTP: the same function as in main.ts, the real Swagger.
 */
import 'reflect-metadata';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applySecurityHeaders } from '../../src/common/config/security-headers';
import { setupSwagger } from '../../src/common/config/swagger';

@Controller('ping')
class PingController {
  @Get() ping() { return { ok: true }; }
}
@Module({ controllers: [PingController] })
class PingModule {}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  app = await NestFactory.create(PingModule, { logger: false });
  applySecurityHeaders(app);
  app.setGlobalPrefix('api');
  setupSwagger(app, { NODE_ENV: 'production', SWAGGER_ENABLED: 'true' });
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(() => app.close());

it('an API route: CSP none with frame-ancestors none, nosniff, HSTS, no X-Powered-By', async () => {
  const res = await fetch(`${base}/api/ping`);
  const h = res.headers;
  expect([res.status, h.get('content-security-policy'), h.get('x-content-type-options'), h.get('x-powered-by')])
    .toEqual([200, "default-src 'none';frame-ancestors 'none'", 'nosniff', null]);
  expect(h.get('strict-transport-security')).toMatch(/max-age=\d+/);
  expect(h.get('x-frame-options')).toBe('SAMEORIGIN');
});

it('Swagger UI still loads (200, no CSP that would block its scripts), the other headers stay', async () => {
  const page = await fetch(`${base}/api/docs/`);
  const init = await fetch(`${base}/api/docs/swagger-ui-init.js`);
  expect([page.status, init.status, page.headers.get('content-security-policy'), page.headers.get('x-powered-by')])
    .toEqual([200, 200, null, null]);
  expect(page.headers.get('x-content-type-options')).toBe('nosniff');
});

it('main.ts applies the headers', () => {
  expect(readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8')).toMatch(/applySecurityHeaders\(app\)/);
});

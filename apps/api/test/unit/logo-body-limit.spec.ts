/**
 * The request body limit for the logo.
 *
 * The logo is base64 up to 700,000 characters (≈500 KB, as the API and the
 * settings form promise), above Nest's default JSON limit of 100 kB. The logo
 * route gets 1 MB; other routes keep 100 kB. Checked over HTTP on a real Nest
 * app, through the same function main.ts calls.
 */import 'reflect-metadata';
import { Body, Controller, INestApplication, Module, Patch, Post, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOGO_ROUTE, allowLargeLogoBody } from '../../src/common/config/body-limits';
import { CompaniesController } from '../../src/companies/companies.controller';

@Controller('companies')
class FakeLogoController {
  @Patch('me/logo')
  upload(@Body('logoBase64') logo: string) {
    return { length: logo.length };
  }
}

@Controller('other')
class OtherController {
  @Post()
  post(@Body('text') text: string) {
    return { length: text.length };
  }
}

@Module({ controllers: [FakeLogoController, OtherController] })
class TestModule {}

async function start(withLogoLimit: boolean): Promise<{ app: INestApplication; base: string }> {
  const app = await NestFactory.create(TestModule, { logger: false });
  if (withLogoLimit) allowLargeLogoBody(app);
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { app, base: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

const logo = (chars: number) => 'data:image/png;base64,' + 'A'.repeat(chars);
const send = (base: string, method: string, path: string, body: object) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('over HTTP', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => ({ app, base } = await start(true)));
  afterAll(async () => app.close());

  it('a 700 000-character logo reaches the handler', async () => {
    const r = await send(base, 'PATCH', '/api/companies/me/logo', { logoBase64: logo(700_000) });
    expect(r.status).toBe(200);
    expect((await r.json()).length).toBe(700_000 + 'data:image/png;base64,'.length);
  });

  it('a body above 1 MB on the logo route → 413', async () => {
    const r = await send(base, 'PATCH', '/api/companies/me/logo', { logoBase64: logo(1_200_000) });
    expect(r.status).toBe(413);
  });

  it('other routes keep the 100 kB default → 413 for 200 kB', async () => {
    const r = await send(base, 'POST', '/api/other', { text: 'x'.repeat(200_000) });
    expect(r.status).toBe(413);
  });

  it('other routes still parse JSON — a small body reaches the handler', async () => {
    // Nest skips its global JSON parser when it sees a middleware named
    // `jsonParser`; the logo parser must not hide it from other routes.
    const r = await send(base, 'POST', '/api/other', { text: 'x'.repeat(1_000) });
    expect(r.status).toBe(201);
    expect((await r.json()).length).toBe(1_000);
  });
});

it('without the logo limit the same logo is refused (the defect)', async () => {
  const { app, base } = await start(false);
  try {
    const r = await send(base, 'PATCH', '/api/companies/me/logo', { logoBase64: logo(700_000) });
    expect(r.status).toBe(413);
  } finally {
    await app.close();
  }
});

it('LOGO_ROUTE is the real route of CompaniesController.uploadLogo', () => {
  const ctrl = Reflect.getMetadata(PATH_METADATA, CompaniesController);
  const handler = CompaniesController.prototype.uploadLogo;
  expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
  expect(`/api/${ctrl}/${Reflect.getMetadata(PATH_METADATA, handler)}`).toBe(LOGO_ROUTE);
});

it('main.ts applies the logo limit before listen', () => {
  const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');
  const at = main.indexOf('allowLargeLogoBody(app)');
  expect(at).toBeGreaterThan(-1);
  expect(at).toBeLessThan(main.indexOf('app.listen('));
});

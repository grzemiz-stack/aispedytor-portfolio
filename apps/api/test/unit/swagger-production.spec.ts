/**
 * Swagger outside an explicit NODE_ENV=development|test (also with no NODE_ENV):
 * it does not exist unless `SWAGGER_ENABLED=true`, and then all of it is served
 * with no key. Checked over HTTP on a real Nest app,
 * through the same function main.ts calls.
 */
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupSwagger, swaggerEnabled } from '../../src/common/config/swagger';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return 'ok';
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

const PATHS = ['/api/docs', '/api/docs/', '/api/docs-json', '/api/docs-yaml', '/api/docs/swagger-ui-init.js'];

async function statuses(env: Record<string, string | undefined>) {
  const app: INestApplication = await NestFactory.create(PingModule, { logger: false });
  app.setGlobalPrefix('api');
  const installed = setupSwagger(app, env);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  try {
    const out: Record<string, number> = {};
    for (const p of PATHS) out[p] = (await fetch(base + p)).status;
    return { installed, out };
  } finally {
    await app.close();
  }
}

const all = (code: number) => Object.fromEntries(PATHS.map((p) => [p, code]));

describe('Swagger over HTTP', () => {
  it('production without the flag → no page, no spec, no assets (404)', async () => {
    const r = await statuses({ NODE_ENV: 'production' });
    expect(r.installed).toBe(false);
    expect(r.out).toEqual(all(404));
  });

  it('production with SWAGGER_ENABLED=true → everything, no key needed', async () => {
    const r = await statuses({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' });
    expect(r.installed).toBe(true);
    expect(r.out).toEqual(all(200));
  });

  it('no NODE_ENV → off (404), as production', async () => {
    const r = await statuses({});
    expect([r.installed, r.out]).toEqual([false, all(404)]);
  });

  it('development → on', async () => {
    const r = await statuses({ NODE_ENV: 'development' });
    expect(r.out).toEqual(all(200));
  });
});

describe('swaggerEnabled', () => {
  it.each([
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: ' Production ' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: '1' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'yes' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }, true],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'TRUE' }, true],
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: ' Development ' }, true],
    [{ NODE_ENV: 'test' }, true],
    // Only an explicit development/test turns it on without the flag: no
    // NODE_ENV, or another environment name, counts as production.
    [{}, false],
    [{ NODE_ENV: '' }, false],
    [{ NODE_ENV: 'staging' }, false],
    [{ SWAGGER_ENABLED: 'true' }, true],
  ])('%j → %s', (env, expected) => {
    expect(swaggerEnabled(env)).toBe(expected);
  });
});

it('main.ts sets Swagger up only through setupSwagger, with no key check', () => {
  const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');
  expect(main).toMatch(/setupSwagger\(app\)/);
  expect(main).not.toMatch(/@nestjs\/swagger|SwaggerModule|query\.key/);
});

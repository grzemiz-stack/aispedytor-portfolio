/**
 * The API start log: the environment, Swagger and registration.
 *
 * Swagger and registration depend on an explicit NODE_ENV and their flags —
 * whoever sets up a server should see it in the start log, not guess. A
 * warning when `NODE_ENV=development` comes with a `FRONTEND_URL` that is not
 * localhost — that looks like a server with a development setting (Swagger,
 * registration and the seed on).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logStartupReport, startupReport } from '../../src/common/config/startup-report';

describe('startupReport — the lines', () => {
  it('production, no flags: everything off, the first company by the script', () => {
    expect(startupReport({ NODE_ENV: 'production' }).lines).toEqual([
      'Environment: NODE_ENV=production',
      'Swagger: off (set SWAGGER_ENABLED=true to turn it on)',
      'Registration (POST /api/auth/register): off — create the first company with npm run company:create',
    ]);
  });

  it('no NODE_ENV: said so, treated as production', () => {
    expect(startupReport({}).lines[0]).toBe('Environment: NODE_ENV is not set (treated as production)');
    expect(startupReport({}).lines.slice(1).every((l) => / off/.test(l))).toBe(true);
  });

  it('development: both on, with the reason', () => {
    expect(startupReport({ NODE_ENV: 'development' }).lines.slice(1)).toEqual([
      'Swagger: on (NODE_ENV=development)',
      'Registration (POST /api/auth/register): on (NODE_ENV=development)',
    ]);
  });

  it('production with the flags: on, with the flag as the reason', () => {
    expect(startupReport({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true', REGISTRATION_ENABLED: 'TRUE' }).lines.slice(1)).toEqual([
      'Swagger: on (SWAGGER_ENABLED=true)',
      'Registration (POST /api/auth/register): on (REGISTRATION_ENABLED=true)',
    ]);
  });

  it('staging counts as production (another name), shown as given', () => {
    const r = startupReport({ NODE_ENV: 'staging' });
    expect(r.lines[0]).toBe('Environment: NODE_ENV=staging (treated as production)');
    expect(r.lines[1]).toMatch(/^Swagger: off/);
  });
});

describe('startupReport — the warning', () => {
  it.each([
    ['https://app.example.com', 1],
    ['http://192.168.1.20:3000', 1],
    ['not a url', 1],
    ['http://localhost:3000', 0],
    ['http://127.0.0.1:3000', 0],
    ['http://[::1]:3000', 0],
    [undefined, 0],
  ])('NODE_ENV=development, FRONTEND_URL=%p → %i warning(s)', (url, n) => {
    expect(startupReport({ NODE_ENV: 'development', FRONTEND_URL: url }).warnings).toHaveLength(n);
  });

  it('names the URL and what development turns on', () => {
    expect(startupReport({ NODE_ENV: 'development', FRONTEND_URL: 'https://app.example.com' }).warnings[0]).toBe(
      'NODE_ENV=development but FRONTEND_URL=https://app.example.com is not localhost — on a server set NODE_ENV=production (development turns on Swagger, registration and the seed)',
    );
  });

  it.each(['production', 'test', undefined])('NODE_ENV=%p with a public FRONTEND_URL → no warning', (nodeEnv) => {
    expect(startupReport({ NODE_ENV: nodeEnv, FRONTEND_URL: 'https://app.example.com' }).warnings).toEqual([]);
  });
});

it('logStartupReport: lines as log, warnings as warn', () => {
  const logger = { log: jest.fn(), warn: jest.fn() };
  logStartupReport(logger, { NODE_ENV: 'development', FRONTEND_URL: 'https://app.example.com' });
  expect([logger.log.mock.calls.length, logger.warn.mock.calls.length]).toEqual([3, 1]);
});

it('main.ts logs the report after the app starts listening', () => {
  const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8');
  const listen = main.indexOf('await app.listen(');
  const report = main.indexOf('logStartupReport(logger)');
  expect(listen).toBeGreaterThan(-1);
  expect(report).toBeGreaterThan(listen);
});

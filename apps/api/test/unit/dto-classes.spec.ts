/**
 * Request bodies and queries are validated classes.
 *
 * An interface is `Object` at runtime, so the global ValidationPipe has
 * nothing to check: a missing required field ended as a 500 in the service
 * and extra fields passed.
 *
 * 1. Guard: no `@Body()` / `@Query()` in any controller has the type `Object`
 *    (an interface, `Omit<>`), and no `@Body('field')` bypasses a DTO.
 * 2. Each DTO through the ValidationPipe with the main.ts settings, with the
 *    parameter type taken from the controller: a missing required field = 400,
 *    a field outside the schema = 400, a valid body passes.
 */
import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { EmailAgentController } from '../../src/email-agent/email-agent.controller';
import { OffersController } from '../../src/offers/offers.controller';
import { CompaniesController } from '../../src/companies/companies.controller';

const SRC = resolve(__dirname, '../../src');
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return controllerFiles(p);
    return e.name.endsWith('.controller.ts') ? [p] : [];
  });
}

interface Arg { where: string; kind: 'body' | 'query'; data?: string; type: any }

function bodyAndQueryArgs(): Arg[] {
  const out: Arg[] = [];
  for (const file of controllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const C of Object.values(require(file)) as any[]) {
      if (typeof C !== 'function') continue;
      for (const m of Object.getOwnPropertyNames(C.prototype)) {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, m) ?? {};
        const types = Reflect.getMetadata('design:paramtypes', C.prototype, m) ?? [];
        for (const [key, a] of Object.entries<any>(args)) {
          const kind = Number(key.split(':')[0]);
          if (kind !== RouteParamtypes.BODY && kind !== RouteParamtypes.QUERY) continue;
          out.push({ where: `${C.name}.${m}`, kind: kind === RouteParamtypes.BODY ? 'body' : 'query', data: a.data, type: types[a.index] });
        }
      }
    }
  }
  return out;
}

describe('guard over every controller', () => {
  const args = bodyAndQueryArgs();

  it('finds the parameters at all', () => {
    expect(args.filter((a) => a.kind === 'body').length).toBeGreaterThan(20);
  });

  it('no @Body() or @Query() object is typed by an interface (runtime type Object)', () => {
    expect(args.filter((a) => a.data === undefined && a.type === Object).map((a) => `${a.where} @${a.kind}`)).toEqual([]);
  });

  it('no @Body(\'field\') — a body is always a whole DTO class', () => {
    expect(args.filter((a) => a.kind === 'body' && a.data !== undefined).map((a) => `${a.where} @Body('${a.data}')`)).toEqual([]);
  });
});

/** The class a controller method validates its @Body/@Query with. */
function paramType(C: any, method: string, kind: 'body' | 'query') {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, method) ?? {};
  const types = Reflect.getMetadata('design:paramtypes', C.prototype, method);
  const want = kind === 'body' ? RouteParamtypes.BODY : RouteParamtypes.QUERY;
  const [, a] = Object.entries<any>(args).find(([k]) => Number(k.split(':')[0]) === want)!;
  return types[a.index];
}

async function check(C: any, method: string, kind: 'body' | 'query', value: object): Promise<'ok' | 400> {
  try {
    await pipe.transform(value, { type: kind, metatype: paramType(C, method, kind), data: '' });
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return 400;
  }
}

const EMAIL = { subject: 'Zlecenie', fromEmail: 'spedycja@firma.example.com', toEmail: 'biuro@spedytor.example.com', body: 'Treść', receivedAt: '2026-10-06T10:00:00.000Z' };

describe('POST /email-agent/process', () => {
  const run = (v: object) => check(EmailAgentController, 'processEmail', 'body', v);
  it('the body the web app sends passes', async () => expect(await run(EMAIL)).toBe('ok'));
  it.each(['subject', 'body', 'fromEmail', 'toEmail'])('missing %s → 400', async (f) => {
    const { [f]: _omit, ...rest } = EMAIL as any;
    expect(await run(rest)).toBe(400);
  });
  it('a field outside the schema → 400', async () => expect(await run({ ...EMAIL, priority: 'HIGH' })).toBe(400));
  it('an invalid sender address → 400', async () => expect(await run({ ...EMAIL, fromEmail: 'nie-adres' })).toBe(400));
});

describe('POST /email-agent/simulate', () => {
  const run = (v: object) => check(EmailAgentController, 'simulate', 'body', v);
  const { toEmail: _t, receivedAt: _r, ...SIM } = EMAIL;
  it('the body the web app sends passes', async () => expect(await run(SIM)).toBe('ok'));
  it('missing body → 400', async () => expect(await run({ subject: 'x', fromEmail: 'a@b.example.com' })).toBe(400));
  it('toEmail is not part of it → 400', async () => expect(await run({ ...SIM, toEmail: 'x@y.example.com' })).toBe(400));
});

describe('PATCH /email-agent/:emailId', () => {
  const run = (v: object) => check(EmailAgentController, 'updateEmail', 'body', v);
  it('notes and tags pass', async () => expect(await run({ notes: 'x', tags: ['a', 'b'] })).toBe('ok'));
  it('a field outside the schema → 400', async () => expect(await run({ notes: 'x', isRead: true })).toBe(400));
  it('tags that are not strings → 400', async () => expect(await run({ tags: [1, 2] })).toBe(400));
});

describe('GET /email-agent/inbox', () => {
  const run = (v: object) => check(EmailAgentController, 'getInbox', 'query', v);
  it('the parameters the web app sends pass', async () => expect(await run({ category: 'OFFER', unreadOnly: 'true', search: 'x' })).toBe('ok'));
  // `page` is part of the schema; `offset` is its deprecated name.
  it('page, limit and the deprecated offset pass', async () => expect(await run({ page: '2', limit: '50', offset: '2' })).toBe('ok'));
  it('a parameter outside the schema → 400', async () => expect(await run({ sortBy: 'receivedAt' })).toBe(400));
  it('unreadOnly other than true/false → 400', async () => expect(await run({ unreadOnly: 'yes' })).toBe(400));
  it('a non-numeric limit → 400', async () => expect(await run({ limit: 'ten' })).toBe(400));
});

const ROW = { pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: '10.10.2026', weightKg: '24000', price: 1200 };

describe('POST /offers/import', () => {
  const run = (v: object) => check(OffersController, 'importOffers', 'body', v);
  // The pipe checks only the request structure; the service checks every row
  // on its own — a bad row goes to `rejected`, it does not give 400 for the
  // whole batch (import-rejected-rows.spec.ts).
  it('a valid import passes', async () => expect(await run({ source: 'api', offers: [ROW] })).toBe('ok'));
  it('missing source → 400', async () => expect(await run({ offers: [ROW] })).toBe(400));
  it('offers that is not a list → 400', async () => expect(await run({ source: 'api', offers: ROW })).toBe(400));
  it('a field outside the schema at the top level → 400', async () => expect(await run({ source: 'api', offers: [ROW], batch: 1 })).toBe(400));
  it.each([
    ['a row missing pickupCity', (({ pickupCity: _p, ...r }) => r)(ROW as any)],
    ['a field outside the schema inside a row', { ...ROW, color: 'red' }],
    ['a weight that is not a number', { ...ROW, weightKg: 'dużo' }],
  ])('%s passes the pipe — the service rejects that row', async (_n, row) => expect(await run({ source: 'api', offers: [row] })).toBe('ok'));
});

describe('PATCH /companies/me/logo', () => {
  const run = (v: object) => check(CompaniesController, 'uploadLogo', 'body', v);
  it('a logo passes', async () => expect(await run({ logoBase64: 'data:image/png;base64,AAAA' })).toBe('ok'));
  it('missing logoBase64 → 400', async () => expect(await run({})).toBe(400));
  it('a field outside the schema → 400', async () => expect(await run({ logoBase64: 'data:image/png;base64,AAAA', name: 'x' })).toBe(400));
});

/**
 * HTTP status codes of POST routes.
 *
 * Rule: a POST that creates a resource → 201; a POST that creates nothing
 * (login, refresh, calculations, evaluation, analysis, simulation, search) →
 * 200 via `@HttpCode(HttpStatus.OK)`. Swagger matches the code.
 *
 * The test reads the metadata of EVERY controller: a new POST outside both
 * lists fails — the 200/201 decision has to be made explicitly.
 */import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';

/** POSTs that create a resource — 201 (Nest's default), Swagger 201. */
const CREATES = [
  'POST /auth/register',
  'POST /contractors',
  'POST /drivers',
  'POST /drivers/:id/status',
  'POST /demands',
  'POST /email-agent/process',
  'POST /email-agent/:emailId/create-offer',
  'POST /exchange-publisher/publish',
  'POST /offers/import',
  'POST /offers',
  'POST /users',
  'POST /vehicles',
];

/** POSTs without a new resource — 200 via @HttpCode, Swagger 200. */
const NO_RESOURCE = [
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /ai-evaluation/evaluate/:offerId',
  'POST /demands/:id/search',
  'POST /demands/:id/subscribe',
  'POST /email-agent/simulate',
  'POST /ltl/search',
  'POST /ltl/load-plan',
  'POST /ltl/load-plan/simulate',
  'POST /ltl/load-plan/optimize',
  'POST /negotiation/analyze/:offerId',
  'POST /negotiation/simulate',
  'POST /offers/economics-preview',
  'POST /risk-analysis/analyze/:offerId',
  'POST /route-planner/calculate',
];

interface PostRoute { route: string; httpCode: number | undefined; swagger2xx: string[] }

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return controllerFiles(p);
    return e.name.endsWith('.controller.ts') ? [p] : [];
  });
}

function postRoutes(): PostRoute[] {
  const out: PostRoute[] = [];
  for (const file of controllerFiles(resolve(__dirname, '../../src'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const exported of Object.values(require(file)) as any[]) {
      if (typeof exported !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported);
      if (base === undefined) continue;
      for (const name of Object.getOwnPropertyNames(exported.prototype)) {
        const handler = exported.prototype[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.POST) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        const responses = Reflect.getMetadata(DECORATORS.API_RESPONSE, handler) ?? {};
        out.push({
          route: `POST /${[base, path].filter((p) => p && p !== '/').join('/')}`,
          httpCode: Reflect.getMetadata(HTTP_CODE_METADATA, handler),
          swagger2xx: Object.keys(responses).filter((s) => /^2\d\d$/.test(s)).sort(),
        });
      }
    }
  }
  return out;
}

const routes = postRoutes();
const byRoute = new Map(routes.map((r) => [r.route, r]));

it('every POST route is on exactly one list — a new POST needs an explicit 200/201 decision', () => {
  expect(routes.map((r) => r.route).sort()).toEqual([...CREATES, ...NO_RESOURCE].sort());
  expect(CREATES.filter((r) => NO_RESOURCE.includes(r))).toEqual([]);
});

it.each(CREATES)('%s creates a resource → 201, Swagger 201', (route) => {
  const r = byRoute.get(route)!;
  expect([route, r.httpCode, r.swagger2xx]).toEqual([route, undefined, ['201']]);
});

it.each(NO_RESOURCE)('%s creates nothing → 200, Swagger 200', (route) => {
  const r = byRoute.get(route)!;
  expect([route, r.httpCode, r.swagger2xx]).toEqual([route, HttpStatus.OK, ['200']]);
});

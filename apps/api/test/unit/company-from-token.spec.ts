/**
 * The company of a request comes only from the token.
 *
 * The API never takes `companyId` from the client; every query uses
 * `req.user.companyId` (JWT). This test guards the rule — a route with
 * `:companyId`, `@Param/@Query/@Body('companyId')` or a `companyId` field in
 * a DTO makes it fail. (A guard that compared `:companyId` with the token
 * would check nothing, since no route has that parameter.)
 */import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { TransEuAuthController } from '../../src/trans-eu-auth/trans-eu-auth.controller';
import { ExchangePublisherController } from '../../src/exchange-publisher/exchange-publisher.controller';

const SRC = resolve(__dirname, '../../src');

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p, test);
    return test(e.name) && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p);

it('no route path has :companyId', () => {
  const hits = files(SRC, (n) => n.endsWith('.controller.ts'))
    .filter((f) => /@(Controller|Get|Post|Put|Patch|Delete)\([^)]*:companyId/.test(readFileSync(f, 'utf8')))
    .map(rel);
  expect(hits).toEqual([]);
});

it('no handler reads companyId from params, query or body', () => {
  const hits = files(SRC, (n) => n.endsWith('.controller.ts'))
    .filter((f) => /@(Param|Query|Body)\(\s*['"]companyId['"]/.test(readFileSync(f, 'utf8')))
    .map(rel);
  expect(hits).toEqual([]);
});

it('no DTO has a companyId field', () => {
  const hits = files(SRC, (n) => n.endsWith('.dto.ts'))
    .filter((f) => /^\s*companyId\??\s*[:!]/m.test(readFileSync(f, 'utf8')))
    .map(rel);
  expect(hits).toEqual([]);
});

it('the routes that had CompanyGuard are still behind JwtAuthGuard', () => {
  const guards = (target: object) => (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
  expect(guards(ExchangePublisherController)).toContain(JwtAuthGuard);
  for (const m of ['connect', 'status', 'disconnect']) {
    const handler = (TransEuAuthController.prototype as any)[m];
    expect([m, guards(handler)]).toEqual([m, expect.arrayContaining([JwtAuthGuard])]);
  }
});

it('there is no CompanyGuard (it never rejected anything)', () => {
  const hits = files(SRC, (n) => n.endsWith('.ts')).filter((f) => readFileSync(f, 'utf8').includes('CompanyGuard')).map(rel);
  expect(hits).toEqual([]);
});

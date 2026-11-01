/**
 * Company scope on every route, with a real token.
 *
 * Unit tests of the services use fakes that ignore `where`, or hold rows of
 * one company only — so removing a `companyId` filter left them green
 * (Prisma drops a filter whose value is `undefined`: a real cross-company
 * read). Here the whole AppModule runs with the real JwtAuthGuard and a
 * token of a user of company A; the database is a fake that RECORDS every
 * query. Every route is called; every read on a table holding company data
 * must filter by company A, and every cache key must carry it.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

/** Encrypted personal fields, so that services that decrypt a user row go on. */
const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
const USER_FIELDS = { emailEncrypted: enc.encrypt('u@example.com'), firstNameEncrypted: enc.encrypt('U'), lastNameEncrypted: enc.encrypt('U'), phoneEncrypted: null };

const COMPANY = 'cmp-A-scope';
const SECRET = 'app-scope-test-'.padEnd(48, 'x');
const USERS: Record<string, { id: string; companyId: string; role: string; isActive: boolean }> = {
  'u-admin': { id: 'u-admin', companyId: COMPANY, role: 'ADMIN', isActive: true },
  'u-disp': { id: 'u-disp', companyId: COMPANY, role: 'DISPATCHER', isActive: true },
};

/** Tables with a `companyId` column: a read must filter by the caller's company. */
const SCOPED = new Set(['user', 'vehicle', 'offer', 'routeCalculation', 'contractor', 'dispatcherDemand', 'notification', 'emailMessage', 'exchangeConnection', 'publishedOffer', 'driver']);
/** Reads, and bulk writes (no unique key — they must be scoped like a read). */
const READS = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']);
/** Single-row writes: scoped, or on a row the same request first found in the caller's company. */
const WRITES = new Set(['update', 'delete', 'upsert']);

/**
 * Reads on a scoped table that need no company filter, each with its reason.
 * `model.method` + a predicate on the `where`.
 */
const ALLOWED: { what: string; why: string; test: (c: Call) => boolean }[] = [
  { what: 'user.findFirst { id: token user, isActive }', why: 'JwtStrategy loads the user of the token — the company comes from that row', test: (c) => c.model === 'user' && c.method === 'findFirst' && c.args?.where?.isActive === true && c.args?.where?.id === 'u-admin' },
  { what: 'user.findUnique { id: token user }', why: 'the caller\'s own row (GET /users/me, password change)', test: (c) => c.model === 'user' && c.method === 'findUnique' && c.args?.where?.id === 'u-admin' },
  { what: 'notification … { userId: token user }', why: 'notifications are the user\'s own — narrower than the company', test: (c) => c.model === 'notification' && c.args?.where?.userId === 'u-admin' },
  { what: 'routeCalculation { offerId }', why: 'rows of an offer already found in the caller\'s company', test: (c) => c.model === 'routeCalculation' && checkedBefore(c, 'offer', c.args?.where?.offerId) },
  { what: 'driver.findFirst { vehicleId, NOT: { id } }', why: 'who else holds a vehicle already found in the caller\'s company (one driver per vehicle)', test: (c) => c.model === 'driver' && checkedBefore(c, 'vehicle', c.args?.where?.vehicleId) },
];

/** An earlier read of `model` with this id, scoped to the caller's company. */
function checkedBefore(c: Call, model: string, id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const i = calls.indexOf(c);
  return calls.slice(0, i).some((p) => p.model === model && READS.has(p.method) && p.args?.where?.id === id && hasCompany(p.args?.where));
}

interface Call { model: string; method: string; args: any }
const calls: Call[] = [];

function hasCompany(where: any, seen = new Set<any>()): boolean {
  if (!where || typeof where !== 'object' || seen.has(where)) return false;
  seen.add(where);
  if (where.companyId === COMPANY) return true;
  if (where.companyId && typeof where.companyId === 'object' && where.companyId.equals === COMPANY) return true;
  for (const k of ['AND']) {
    const v = where[k];
    if (Array.isArray(v) ? v.some((w) => hasCompany(w, seen)) : hasCompany(v, seen)) return true;
  }
  // A unique compound key that carries the company, e.g. { companyId_source_externalId: { companyId, … } }.
  return Object.entries(where).some(([k, v]) => k.startsWith('companyId_') && (v as any)?.companyId === COMPANY);
}

const recordingPrisma: any = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, prop) {
    if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
    if (prop === '$queryRaw') return async () => [{ ok: 1 }];
    if (prop === '$transaction') return async (arg: any) => (typeof arg === 'function' ? arg(recordingPrisma) : Promise.all(arg));
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    if (!(prop in target)) {
      const model = String(prop);
      target[prop] = new Proxy({}, {
        get: (_t, method) => async (args: any) => {
          calls.push({ model, method: String(method), args });
          if (model === 'user' && (method === 'findFirst' || method === 'findUnique') && USERS[args?.where?.id]) {
            const u = USERS[args.where.id];
            return args.where.isActive === undefined || args.where.isActive === u.isActive ? { ...u } : null;
          }
          // One route group, so that per-route queries run too (analytics top routes).
          if (method === 'groupBy' && SCOPED.has(model) && hasCompany(args?.where)) {
            return [{ pickupCountry: 'PL', deliveryCountry: 'DE', _count: { id: 1 }, _avg: { pricePerKm: 1 } }];
          }
          // One row of company A for a scoped list, so that per-row queries run too.
          if (method === 'findMany' && SCOPED.has(model) && hasCompany(args?.where)) {
            return [{ id: `${model}-A1`, companyId: COMPANY, createdAt: new Date('2026-10-01T00:00:00Z'), status: 'NEW', price: null, currency: 'EUR', ...(model === 'user' ? USER_FIELDS : {}) }];
          }
          if (method === 'findMany' || method === 'groupBy') return [];
          if (method === 'count') return 0;
          if (method === 'aggregate') return { _sum: {}, _avg: {}, _min: {}, _max: {}, _count: {} };
          // A single row exists only for a query scoped to company A — so the
          // service goes on to its next queries, which are checked too.
          if ((method === 'findFirst' || method === 'findUnique') && SCOPED.has(model) && hasCompany(args?.where)) {
            return {
              id: args.where.id ?? `${model}-A`, companyId: COMPANY, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
              // Links the services follow to their next queries (checked as well).
              contractorId: 'contractor-B', createdOfferId: 'offer-B', parentVehicleId: null, vehicleId: 'vehicle-B',
              price: 1000, currency: 'EUR', distanceKm: 500, weightKg: 1000, pickupCountry: 'PL', deliveryCountry: 'DE',
              pickupCity: 'Poznań', deliveryCity: 'Berlin', pickupDate: new Date('2030-10-10T08:00:00Z'), status: 'NEW', role: 'ADMIN', isActive: true,
              vehicleCategory: 'TRACTOR', ...(model === 'user' ? USER_FIELDS : {}),
            };
          }
          if (method === 'updateMany' || method === 'deleteMany') return { count: 0 };
          if (method === 'createMany') return { count: Array.isArray(args?.data) ? args.data.length : 1 };
          if (method === 'create' || method === 'update' || method === 'upsert') return { id: `${model}-A`, companyId: COMPANY, ...(args?.data ?? {}) };
          return null;
        },
      });
    }
    return target[prop];
  },
});

const cacheKeys: string[] = [];
/** Cache keys of data shared by all companies, with the reason. */
const SHARED_CACHE = [
  { prefix: 'restrictions:', why: 'truck restrictions per country — reference data, no company data' },
];
let app: INestApplication;
let port: number;
let token: string;

function routes(): { method: string; path: string }[] {
  const router = app.getHttpAdapter().getInstance()._router as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  return router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })));
}

function call(method: string, path: string, body?: object, bearer = token): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}));
  });
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'test-unknown-0000');

/** Valid bodies for write routes, so that they reach the service and its queries. Ids are not company A's. */
const LOAD = { offerId: 'offer-B', weight: 100, meters: 1, loadingCity: 'Poznań', unloadingCity: 'Berlin' };
const BODIES: Record<string, object> = {
  'POST /api/ltl/search': { vehicleId: 'vehicle-B', currentLoadMeters: 0, currentLoadWeight: 0, routeFrom: 'Poznań, PL', routeTo: 'Berlin, DE' },
  'POST /api/ltl/load-plan': { vehicleId: 'vehicle-B', loads: [LOAD] },
  'POST /api/ltl/load-plan/simulate': { vehicleId: 'vehicle-B', loads: [LOAD] },
  'POST /api/ltl/load-plan/optimize': { vehicleId: 'vehicle-B', loads: [LOAD] },
  'POST /api/negotiation/simulate': { offerId: 'offer-B', proposedPrice: 1000 },
  'POST /api/route-planner/calculate': { origin: { lat: 52.4, lng: 16.9 }, destination: { lat: 52.5, lng: 13.4 }, vehicle: { grossWeight: 40, height: 4, width: 2.55, length: 16.5, hasAdr: false }, offerId: 'offer-B' },
  'POST /api/offers': { pickupCity: 'Poznań', pickupCountry: 'PL', pickupDate: '2030-10-10', deliveryCity: 'Berlin', deliveryCountry: 'DE', contractorId: 'contractor-B' },
  'PUT /api/drivers/:id/vehicle': { vehicleId: 'vehicle-B' },
  'POST /api/vehicles': { plateNumber: 'SCOPE-1', vehicleType: 'STANDARD', vehicleCategory: 'SEMI_TRAILER', dispatcherId: 'user-B', parentVehicleId: 'vehicle-B' },
  'PATCH /api/vehicles/:id': { dispatcherId: 'user-B', vehicleCategory: 'TRUCK' },
  'POST /api/offers/import': { source: 'trans-eu', offers: [{ externalId: 'x-1', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: '2030-10-10' }] },
  'PATCH /api/offers/:id/status': { status: 'ASSIGNED' },
};

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
  // Integration status reads the exchange connection only when configured.
  process.env.TRANS_EU_CLIENT_ID = 'scope-test';
  const { AppModule } = await import('../../src/app.module');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const { ThrottlerGuard } = await import('@nestjs/throttler');
  const { MemoryCacheService } = await import('../../src/common/cache/memory-cache.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(recordingPrisma)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  // The same pipe as main.ts — without it empty bodies reach the services.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  const cache = app.get(MemoryCacheService, { strict: false });
  const realGet = cache.get.bind(cache);
  const realSet = cache.set.bind(cache);
  jest.spyOn(cache, 'get').mockImplementation((k: string) => { cacheKeys.push(k); return realGet(k); });
  jest.spyOn(cache, 'set').mockImplementation((k: string, v: unknown, ttl?: number) => { cacheKeys.push(k); return realSet(k, v, ttl); });
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  // Start-up queries (the Trans.eu token encryption migration reads every
  // connection once) are not requests of a user — count only from here.
  calls.length = 0;
  cacheKeys.length = 0;
  token = new JwtService({ secret: SECRET }).sign({ sub: 'u-admin', companyId: COMPANY, role: 'ADMIN', email: 'admin@example.com' }, { expiresIn: '15m' });

  for (const r of routes()) await call(r.method, concrete(r.path), BODIES[`${r.method} ${r.path}`]);
}, 120_000);

afterAll(async () => {
  await app?.close();
  jest.restoreAllMocks();
  delete process.env.TRANS_EU_CLIENT_ID;
});

it('the routes were called with the token and reached the database', () => {
  const scopedReads = calls.filter((c) => SCOPED.has(c.model) && READS.has(c.method));
  expect(scopedReads.length).toBeGreaterThan(40);
});

it('every read on a table with company data filters by the caller\'s company', () => {
  const unscoped = calls
    .filter((c) => SCOPED.has(c.model) && READS.has(c.method))
    .filter((c) => !hasCompany(c.args?.where))
    .filter((c) => !ALLOWED.some((a) => a.test(c)))
    .map((c) => `${c.model}.${c.method} ${JSON.stringify(c.args?.where)}`);
  expect([...new Set(unscoped)]).toEqual([]);
});

it('every single-row write is scoped, or on a row first found in the caller\'s company', () => {
  const loose = calls
    .filter((c) => SCOPED.has(c.model) && WRITES.has(c.method))
    .filter((c) => !hasCompany(c.args?.where) && !checkedBefore(c, c.model, c.args?.where?.id))
    .map((c) => `${c.model}.${c.method} ${JSON.stringify(c.args?.where)}`);
  expect([...new Set(loose)]).toEqual([]);
});

it('a company row is read only for the caller\'s company', () => {
  const other = calls.filter((c) => c.model === 'company' && READS.has(c.method) && c.args?.where?.id !== COMPANY);
  expect(other.map((c) => `${c.method} ${JSON.stringify(c.args?.where)}`)).toEqual([]);
});

it('every cache key carries the caller\'s company', () => {
  expect(cacheKeys.length).toBeGreaterThan(0);
  const shared = (k: string) => SHARED_CACHE.some((s) => k.startsWith(s.prefix));
  expect([...new Set(cacheKeys.filter((k) => !k.includes(COMPANY) && !shared(k)))]).toEqual([]);
});

describe('the real JwtAuthGuard and RolesGuard with real tokens', () => {
  const sign = (payload: object, opts: object = { expiresIn: '15m' }) => new JwtService({ secret: SECRET }).sign(payload, opts);
  const admin = { sub: 'u-admin', companyId: COMPANY, role: 'ADMIN', email: 'admin@example.com' };

  it('a valid token → not 401', async () => {
    expect(await call('GET', '/api/users/me')).not.toBe(401);
  });

  it('an expired token → 401', async () => {
    const expired = sign({ ...admin, exp: Math.floor(Date.now() / 1000) - 60 }, {});
    expect(await call('GET', '/api/users/me', undefined, expired)).toBe(401);
  });

  it('a token signed with another secret → 401', async () => {
    const forged = new JwtService({ secret: 'z'.repeat(48) }).sign(admin, { expiresIn: '15m' });
    expect(await call('GET', '/api/users/me', undefined, forged)).toBe(401);
  });

  it('a token of an unknown or deactivated user → 401', async () => {
    expect(await call('GET', '/api/users/me', undefined, sign({ ...admin, sub: 'u-gone' }))).toBe(401);
  });

  it.each([
    ['GET', '/api/users'],
    ['GET', '/api/users/test-unknown-0000'],
    ['POST', '/api/users'],
    ['DELETE', '/api/users/test-unknown-0000'],
    // Linking and unlinking the company's Trans.eu account — ADMIN only.
    ['GET', '/api/integrations/transeu/connect'],
    ['DELETE', '/api/integrations/transeu/disconnect'],
  ])('a dispatcher on %s %s (ADMIN only) → 403', async (method, path) => {
    const dispatcher = sign({ sub: 'u-disp', companyId: COMPANY, role: 'DISPATCHER', email: 'd@example.com' });
    expect(await call(method, path, { email: 'n@example.com', password: 'Abcdefgh1!', firstName: 'N', lastName: 'N', role: 'DISPATCHER' }, dispatcher)).toBe(403);
  });

  it('a dispatcher whose TOKEN claims ADMIN is still a dispatcher (the role comes from the database)', async () => {
    const lying = sign({ sub: 'u-disp', companyId: COMPANY, role: 'ADMIN', email: 'd@example.com' });
    expect(await call('GET', '/api/users', undefined, lying)).toBe(403);
  });
});

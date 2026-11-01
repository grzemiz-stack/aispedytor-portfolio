/**
 * The whole application starts, and the real JwtAuthGuard protects every
 * route that is not public on purpose.
 *
 * Unit tests build services by hand (`new DriversService(prisma, …)`), and
 * controller tests stub the guard — so neither shows that Nest can assemble
 * the module graph (a provider without its module, a missing export, a
 * cycle) or that a route is protected at all. Here the full AppModule is
 * assembled with only the database replaced, served on 127.0.0.1, and every
 * registered route is called without a token.
 *
 * A route answering without a token must be in PUBLIC_ROUTES with its
 * reason; a new public route fails this test until someone writes one.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/** Routes that answer without a token on purpose — `METHOD path` with the reason. */
const PUBLIC_ROUTES: Record<string, string> = {
  'POST /api/auth/login': 'signing in',
  'POST /api/auth/register': 'creating a company and its first account — only when registration is enabled (REGISTRATION_ENABLED), else 403',
  'POST /api/auth/refresh': 'a new access token from the refresh token',
  'GET /api/integrations/transeu/callback': 'the OAuth redirect from Trans.eu carries no JWT; the signed `state` binds it to the company, the HttpOnly cookie from `connect` to the browser that started it',
};

/**
 * The database is the only thing replaced: nothing is queried at start-up
 * except the Trans.eu token migration (`findMany` → no rows).
 */
const fakePrisma = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, prop) {
    if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
    if (prop === 'then') return undefined;
    if (!(prop in target)) {
      target[prop] = new Proxy({}, { get: (_t, method) => async () => (method === 'findMany' ? [] : null) });
    }
    return target[prop];
  },
});

let app: INestApplication;
let port: number;

interface RouteInfo {
  method: string;
  path: string;
}

function routes(): RouteInfo[] {
  const router = app.getHttpAdapter().getInstance()._router as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route!.methods).map((m) => ({ method: m.toUpperCase(), path: layer.route!.path })));
}

function call(method: string, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(method === 'GET' || method === 'DELETE' ? undefined : '{}');
  });
}

/** `:id` and other parameters → a value no record has. */
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'test-unknown-0000');

beforeAll(async () => {
  // Real-looking secrets (validateEnv refuses placeholders); process.env wins over a local .env.
  process.env.JWT_SECRET = 'app-start-test-'.padEnd(48, 'x');
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
  const { AppModule } = await import('../../src/app.module');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const { ThrottlerGuard } = await import('@nestjs/throttler');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(fakePrisma)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  // The rate limit (100 per minute) is not what this test is about; every route is called twice.
  jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
}, 60_000);

afterAll(async () => {
  await app?.close();
  jest.restoreAllMocks();
});

describe('the application starts', () => {
  it('the whole AppModule assembles and serves routes', () => {
    // 88 routes on 10 Oct 2026; far fewer means a module dropped out of the graph.
    expect(routes().length).toBeGreaterThanOrEqual(80);
  });

  it('the driver activity provider is wired (the gateway token resolves)', async () => {
    const { DRIVER_ACTIVITY_PROVIDER } = await import('../../src/fleet-planning/activity/driver-activity-provider');
    expect(app.get(DRIVER_ACTIVITY_PROVIDER, { strict: false }).source).toBe('manual');
  });
});

describe('the real JwtAuthGuard', () => {
  it('every route that is not public answers 401 without a token', async () => {
    const open: string[] = [];
    for (const r of routes()) {
      const key = `${r.method} ${r.path}`;
      if (key in PUBLIC_ROUTES) continue;
      const status = await call(r.method, concrete(r.path));
      if (status !== 401) open.push(`${key} → ${status}`);
    }
    expect(open).toEqual([]);
  });

  it('a token that is not a JWT is refused the same way', async () => {
    const open: string[] = [];
    for (const r of routes()) {
      if (`${r.method} ${r.path}` in PUBLIC_ROUTES) continue;
      const status = await call(r.method, concrete(r.path), { authorization: 'Bearer not-a-token' });
      if (status !== 401) open.push(`${r.method} ${r.path} → ${status}`);
    }
    expect(open).toEqual([]);
  });

  it('every public route exists (the list does not rot) and does not answer 401', async () => {
    const registered = new Set(routes().map((r) => `${r.method} ${r.path}`));
    const missing = Object.keys(PUBLIC_ROUTES).filter((k) => !registered.has(k));
    const refused: string[] = [];
    for (const key of Object.keys(PUBLIC_ROUTES)) {
      const [method, path] = key.split(' ');
      if ((await call(method, path)) === 401) refused.push(key);
    }
    expect([missing, refused]).toEqual([[], []]);
  });
});

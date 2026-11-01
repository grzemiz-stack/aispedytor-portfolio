/**
 * /health/integrations — behind login, no faked status.
 * The only public check is /api/health → alive.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HealthController } from '../../src/health/health.controller';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

function controller(opts: { env?: Record<string, string>; connections?: Record<string, string>; dbDown?: boolean } = {}) {
  const prisma: any = {
    $queryRaw: jest.fn(async () => { if (opts.dbDown) throw new Error('down'); return [1]; }),
    exchangeConnection: {
      findUnique: jest.fn(async ({ where }: any) => {
        const status = opts.connections?.[where.companyId_exchange.companyId];
        return status ? { status } : null;
      }),
    },
  };
  const config: any = { get: (k: string) => opts.env?.[k] };
  // Fake cache with keys — the real cache service holds a timer that would keep the test run from exiting.
  const store = new Map<string, unknown>();
  const cache: any = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v), getStats: () => ({ size: store.size }) };
  const queue: any = { getStats: () => ({ pending: 0, active: 0, processed: 0, failed: 0 }) };
  return { ctrl: new HealthController(prisma, config, cache, queue), prisma };
}
const req = (companyId: string) => ({ user: { companyId } }) as any;

describe('health — honest and behind login', () => {
  it('the controller is behind JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController)).toContain(JwtAuthGuard);
  });

  it('checks only the database and Trans.eu (plus uptime, version, cache, queue) — no external routing/toll service, no network call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    const { ctrl } = controller();
    const r: any = await ctrl.getIntegrations(req('comp-1'));
    expect(Object.keys(r).sort()).toEqual(['cache', 'database', 'queue', 'transEu', 'uptime', 'version']);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    [{}, {}, 'not_configured'],
    [{ TRANS_EU_CLIENT_ID: 'id' }, {}, 'not_connected'],
    [{ TRANS_EU_CLIENT_ID: 'id' }, { 'comp-1': 'ACTIVE' }, 'connected'],
    [{ TRANS_EU_CLIENT_ID: 'id' }, { 'comp-1': 'EXPIRED' }, 'expired'],
    [{ TRANS_EU_CLIENT_ID: 'id' }, { 'comp-1': 'DISCONNECTED' }, 'not_connected'],
  ])('Trans.eu from the database: env %p, connections %p → %s', async (env, connections, expected) => {
    const { ctrl } = controller({ env, connections });
    expect((await ctrl.getIntegrations(req('comp-1'))).transEu).toBe(expected);
  });

  it('per company: one company’s Trans.eu status never leaks to another through the cache', async () => {
    const { ctrl } = controller({ env: { TRANS_EU_CLIENT_ID: 'id' }, connections: { 'comp-1': 'ACTIVE' } });
    expect((await ctrl.getIntegrations(req('comp-1'))).transEu).toBe('connected');
    expect((await ctrl.getIntegrations(req('comp-2'))).transEu).toBe('not_connected');
  });

  it('database down → error, not ok', async () => {
    const { ctrl } = controller({ dbDown: true });
    expect((await ctrl.getIntegrations(req('comp-1'))).database).toBe('error');
  });

  it('version is not invented: npm_package_version or "unknown"', async () => {
    const saved = process.env.npm_package_version;
    delete process.env.npm_package_version;
    const { ctrl } = controller();
    expect((await ctrl.getIntegrations(req('comp-1'))).version).toBe('unknown');
    if (saved !== undefined) process.env.npm_package_version = saved;
  });
});

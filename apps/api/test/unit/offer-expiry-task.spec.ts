/**
 * The expiry task expires NEW offers that are dead by the LTL rule.
 *
 * Before: every hour only NEW offers older than 7 days became EXPIRED — an
 * offer with a passed loading day or a passed `expiresAt` stayed NEW (the
 * matching lists and LTL hid it, the database and the offer list did not).
 * Now:
 *  - NEW with `deadReason != null` (EXPIRED / TOO_OLD / PICKUP_PASSED; the
 *    loading day in the pickup country's zone, a country outside the map →
 *    the company country) → EXPIRED;
 *  - ASSIGNED unchanged; written only while the offer is still NEW;
 *  - no notifications, no reason stored — a log line with counts by reason;
 *  - the offer list cache cleared for the companies with expired offers.
 *
 * A fake clock (jest.useFakeTimers) — dates count from NOW, nothing
 * hardcoded "in the future".
 */
import 'reflect-metadata';
import { OfferExpiryTask } from '../../src/common/tasks/offer-expiry.task';

const DAY = 86_400_000;
const NOW = new Date('2026-10-11T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

const offer = (id: string, over: object = {}) => ({
  id, companyId: 'c1', status: 'NEW', pickupCountry: 'PL', pickupDate: ahead(2), createdAt: ago(1), expiresAt: null,
  company: { country: 'PL' }, ...over,
});

function setup(candidates: any[]) {
  const prisma: any = {
    offer: {
      // The mock does not filter — the rule must work in the code, not only in the query.
      findMany: jest.fn(async () => candidates),
      updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
    },
  };
  const cache: any = { deleteByPrefix: jest.fn() };
  const task = new OfferExpiryTask(prisma, cache);
  const log = jest.spyOn((task as any).logger, 'log').mockImplementation(() => undefined);
  return { task, prisma, cache, log };
}
const expiredIds = (prisma: any) => prisma.offer.updateMany.mock.calls.flatMap((c: any) => c[0].where.id.in).sort();

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => jest.useRealTimers());

describe('OfferExpiryTask — NEW with deadReason → EXPIRED', () => {
  it.each([
    ['the loading day passed (yesterday in PL), created 1 day ago', true, { pickupDate: new Date('2026-10-10T00:00:00Z') }],
    ['expiresAt passed', true, { expiresAt: ago(0.01) }],
    ['older than 7 days, loading ahead', true, { createdAt: ago(8) }],
    ['loading today (a date without a time)', false, { pickupDate: new Date('2026-10-11T00:00:00Z') }],
    ['live: loading ahead, fresh, no expiresAt', false, {}],
  ])('%s → expired: %s', async (_n, expired, over) => {
    const { task, prisma } = setup([offer('x', over)]);
    await task.handleExpiry();
    expect(expiredIds(prisma)).toEqual(expired ? ['x'] : []);
  });

  it('the loading day is the day in the pickup country zone: 10.10 22:30Z is 11.10 in Warsaw (live), 10.10 in Lisbon (dead)', async () => {
    const at = new Date('2026-10-10T22:30:00Z');
    const { task, prisma } = setup([offer('pl', { pickupDate: at }), offer('pt', { pickupDate: at, pickupCountry: 'PT' })]);
    await task.handleExpiry();
    expect(expiredIds(prisma)).toEqual(['pt']);
  });

  it('a pickup country outside the zone map takes the company country', async () => {
    // 10.10 22:30Z: already 11.10 in Warsaw (live), still 10.10 in Lisbon (dead).
    const at = new Date('2026-10-10T22:30:00Z');
    const { task, prisma } = setup([
      offer('co-pl', { pickupDate: at, pickupCountry: 'XX', company: { country: 'PL' } }),
      offer('co-pt', { pickupDate: at, pickupCountry: 'XX', company: { country: 'PT' } }),
    ]);
    await task.handleExpiry();
    expect(expiredIds(prisma)).toEqual(['co-pt']);
  });

  it('the query: only NEW, candidates by expiresAt, age or a loading instant before now — ASSIGNED never read', async () => {
    const { task, prisma } = setup([]);
    await task.handleExpiry();
    const where = prisma.offer.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('NEW');
    expect(where.OR).toEqual([
      { expiresAt: { lte: NOW } },
      { createdAt: { lt: ago(7) } },
      { pickupDate: { lt: NOW } },
    ]);
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  it('the write is guarded by status NEW (an offer assigned meanwhile does not expire)', async () => {
    const { task, prisma } = setup([offer('x', { createdAt: ago(8) })]);
    await task.handleExpiry();
    expect(prisma.offer.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['x'] }, status: 'NEW' },
      data: { status: 'EXPIRED' },
    });
  });

  it('the log gives the counts by reason; the offer list cache is cleared for each company with expired offers', async () => {
    const { task, cache, log } = setup([
      offer('a', { expiresAt: ago(0.01) }),
      offer('b', { createdAt: ago(8) }),
      offer('c', { createdAt: ago(9), companyId: 'c2' }),
      offer('d', { pickupDate: ago(2) }),
      offer('live', { companyId: 'c3' }),
    ]);
    await task.handleExpiry();
    expect(log).toHaveBeenCalledWith('[OfferExpiry] Expired 4 offers (EXPIRED 1, TOO_OLD 2, PICKUP_PASSED 1)');
    expect(cache.deleteByPrefix.mock.calls.map((c: any) => c[0]).sort()).toEqual(['offers:c1', 'offers:c2']);
  });

  it('nothing dead → no write, no log, no cache clearing', async () => {
    const { task, prisma, cache, log } = setup([offer('live')]);
    await task.handleExpiry();
    expect([prisma.offer.updateMany.mock.calls.length, log.mock.calls.length, cache.deleteByPrefix.mock.calls.length]).toEqual([0, 0, 0]);
  });

  it('candidates are read in pages by id > the last id (no Prisma cursor: the cursor row has just changed status) — a large first run does not load everything at once', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => offer(`a${String(i).padStart(4, '0')}`, { createdAt: ago(8) }));
    const page2 = [offer('b0001', { createdAt: ago(8) })];
    const { task, prisma } = setup([]);
    prisma.offer.findMany.mockImplementationOnce(async () => page1).mockImplementationOnce(async () => page2);
    await task.handleExpiry();
    // `cursor` + `skip: 1` skipped an offer at a page boundary — the cursor row had just become EXPIRED,
    // so it no longer matched `where`, and `skip` swallowed the next one.
    const calls = prisma.offer.findMany.mock.calls.map((c: any) => [c[0].take, c[0].where.id ?? null, 'cursor' in c[0], 'skip' in c[0]]);
    expect(calls).toEqual([[1000, null, false, false], [1000, { gt: 'a0999' }, false, false]]);
    expect(expiredIds(prisma)).toHaveLength(1001);
  });
});

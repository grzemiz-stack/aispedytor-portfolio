/**
 * Recomputing the cost, profit and margin of existing offers.
 *
 * New offers get their margin from `offerCost`; older ones keep the margin the
 * form computed from fuel and toll (flag `false`, so it counts as full).
 * Now:
 *  - `npm run offers:recompute-economics [--dry-run]` recomputes ALL offers,
 *    accepted ones too (an old margin "from fuel" is a wrong number, not
 *    history); the cost at today's company rate; idempotent — a second run
 *    changes nothing; `--dry-run` writes nothing and gives the same counts
 *    (offers, full / upper bound / empty, changed);
 *  - from then on a change of the company cost per km or currency recomputes
 *    the open offers (NEW, ASSIGNED) in the background (the task queue, not
 *    inside the request); an error → a warn, the rate stays; from ACCEPTED on
 *    the margin stays as it was.
 */
import { recomputeEconomics, parseRecomputeArgs } from '../../src/offers/recompute-economics';
import { Logger } from '@nestjs/common';
import { CompaniesService } from '../../src/companies/companies.service';

type Row = Record<string, any>;
const offer = (id: string, over: Row = {}): Row => ({
  id, companyId: 'c1', status: 'NEW', price: 1000, currency: 'EUR', distanceKm: 300, tollCostEstimate: null,
  totalCostEstimate: null, profitEstimate: null, profitMarginPercent: null, marginWithoutTolls: null, ...over,
});

/** A Prisma fake on rows — findMany with an id cursor, update writes into the row. */
const trusted = (r: Row) => r.distanceKm > 0 && !(r.distanceKm === 500 && (r.tollBreakdown ?? []).length === 0);

function db(rows: Row[], opts: { companies?: Record<string, { costPerKm: number | null; costCurrency: string }>; routes?: Row[] } = {}) {
  const companies = opts.companies ?? { c1: { costPerKm: 4.2, costCurrency: 'PLN' } };
  const prisma: any = {
    offer: {
      findMany: jest.fn(async ({ where, take, cursor, skip, orderBy }: any) => {
        expect(orderBy).toEqual({ id: 'asc' });
        let list = rows
          .filter((r) => (!where?.companyId || r.companyId === where.companyId) && (!where?.status?.in || where.status.in.includes(r.status)))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
        if (cursor) list = list.slice(list.findIndex((r) => r.id === cursor.id) + (skip ?? 0));
        return list.slice(0, take).map((r) => ({ ...r }));
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    },
    company: { findUnique: jest.fn(async ({ where }: any) => companies[where.id] ?? null) },
    routeCalculation: {
      // A stand-in for the rule in common/route-trust.ts (on Postgres — test/integration/route-trust.int-spec.ts).
      findMany: jest.fn(async ({ where }: any) =>
        (opts.routes ?? []).filter((r) => where.offerId.in.includes(r.offerId) && (!where.NOT || trusted(r)))),
      count: jest.fn(async ({ where }: any) =>
        (opts.routes ?? []).filter((r) => where.offerId.in.includes(r.offerId) && !trusted(r)).length),
    },
  };
  return prisma;
}

describe('recomputeEconomics', () => {
  it('every offer, accepted ones too; the counts full / upper bound / empty; the company read once', async () => {
    const rows = [
      offer('a'), // no toll → an upper bound
      offer('b', { status: 'ACCEPTED', tollCostEstimate: 80, profitMarginPercent: 55, marginWithoutTolls: false }), // an old one "from fuel" → full again
      offer('c', { price: null }), // no price → empty
      offer('d', { status: 'COMPLETED' }),
    ];
    const prisma = db(rows);
    const r = await recomputeEconomics(prisma, { batchSize: 2 });
    expect(r).toEqual({ offers: 4, full: 1, upperBound: 2, empty: 1, changed: 3, suspectRoutes: 0 });
    expect(rows.find((o) => o.id === 'b')).toMatchObject({ totalCostEstimate: 369.8, profitMarginPercent: 63.02, marginWithoutTolls: false });
    expect(prisma.company.findUnique).toHaveBeenCalledTimes(1);
  });

  it('idempotent: a second run changes nothing and writes nothing', async () => {
    const rows = [offer('a'), offer('b', { tollCostEstimate: 80 })];
    const prisma = db(rows);
    await recomputeEconomics(prisma, {});
    prisma.offer.update.mockClear();
    const again = await recomputeEconomics(prisma, {});
    expect([again.changed, prisma.offer.update.mock.calls.length]).toEqual([0, 0]);
  });

  it('only the flag differs (the migration set false, the rule says upper bound) → changed and fixed', async () => {
    const rows = [offer('a', { totalCostEstimate: 289.8, profitEstimate: 710.2, profitMarginPercent: 71.02, marginWithoutTolls: false })];
    const r = await recomputeEconomics(db(rows), {});
    expect([r.changed, rows[0].marginWithoutTolls]).toEqual([1, true]);
  });

  it('--dry-run: the same counts, nothing written', async () => {
    const rows = [offer('a'), offer('b', { profitMarginPercent: 55, marginWithoutTolls: false })];
    const prisma = db(rows);
    const dry = await recomputeEconomics(prisma, { dryRun: true });
    expect(prisma.offer.update).not.toHaveBeenCalled();
    expect(rows[1].profitMarginPercent).toBe(55);
    const real = await recomputeEconomics(db(rows.map((r) => ({ ...r }))), {});
    expect(dry).toEqual(real);
  });

  it('the latest planner route of each offer is used (km and toll)', async () => {
    const rows = [offer('a', { distanceKm: 250 })];
    const prisma = db(rows, { routes: [
      { offerId: 'a', distanceKm: 300, tollTotalEur: 80, calculatedAt: new Date('2030-01-02') },
      { offerId: 'a', distanceKm: 999, tollTotalEur: 999, calculatedAt: new Date('2030-01-01') },
    ] });
    await recomputeEconomics(prisma, {});
    expect(rows[0]).toMatchObject({ totalCostEstimate: 369.8, marginWithoutTolls: false });
  });

  it('a saved route row without a toll (null) stays "no toll" — an upper bound, not a toll of 0', async () => {
    const rows = [offer('a', { distanceKm: 250 })];
    await recomputeEconomics(db(rows, { routes: [{ offerId: 'a', distanceKm: 300, tollTotalEur: null, calculatedAt: new Date('2030-01-02') }] }), {});
    expect(rows[0]).toMatchObject({ totalCostEstimate: 289.8, marginWithoutTolls: true });
  });

  it('suspected fallback routes (0 km, a flat 500 km without a toll breakdown) are ignored and counted; the latest trusted route is used', async () => {
    const rows = [offer('a', { distanceKm: 280 })];
    const routes = [
      { offerId: 'a', distanceKm: 300, tollTotalEur: 50, tollBreakdown: [{ countryCode: 'PL' }], calculatedAt: new Date('2026-10-01') },
      { offerId: 'a', distanceKm: 500, tollTotalEur: 0, tollBreakdown: [], calculatedAt: new Date('2026-10-02') },
      { offerId: 'a', distanceKm: 0, tollTotalEur: 0, tollBreakdown: [], calculatedAt: new Date('2026-10-03') },
    ];
    const prisma = db(rows, { routes });
    const r = await recomputeEconomics(prisma);
    expect(r.suspectRoutes).toBe(2);
    // The cost from the 300 km route with toll 50 (a full margin), not from 500 km or 0 km.
    const viaTrusted = await recomputeEconomics(db([offer('b', { distanceKm: 280 })], { routes: [{ ...routes[0], offerId: 'b' }] }));
    expect(viaTrusted.suspectRoutes).toBe(0);
    expect(rows[0].marginWithoutTolls).toBe(false);
  });

  it('each company with its own rate; a company without a rate → empty, not a guess', async () => {
    const rows = [offer('a'), offer('b', { companyId: 'c2' })];
    const r = await recomputeEconomics(db(rows, { companies: { c1: { costPerKm: 4.2, costCurrency: 'PLN' }, c2: { costPerKm: null, costCurrency: 'PLN' } } }), {});
    expect([rows[0].profitMarginPercent, rows[1].profitMarginPercent, r.empty]).toEqual([71.02, null, 1]);
  });

  it('scoped to one company and statuses (the rate change path)', async () => {
    const rows = [offer('a'), offer('b', { status: 'ASSIGNED' }), offer('c', { status: 'ACCEPTED' }), offer('d', { companyId: 'c2' })];
    const r = await recomputeEconomics(db(rows, { companies: { c1: { costPerKm: 4.2, costCurrency: 'PLN' }, c2: { costPerKm: 4.2, costCurrency: 'PLN' } } }), { companyId: 'c1', statuses: ['NEW', 'ASSIGNED'] });
    expect([r.offers, rows[2].profitMarginPercent, rows[3].profitMarginPercent]).toEqual([2, null, null]);
  });
});

describe('the command line', () => {
  it.each([
    [[], { dryRun: false }],
    [['--dry-run'], { dryRun: true }],
  ])('%j → %j', (argv, expected) => {
    expect(parseRecomputeArgs(argv as string[])).toEqual(expected);
  });

  it('an unknown argument → an error (no silent full run)', () => {
    expect(() => parseRecomputeArgs(['--dryrun'])).toThrow(/--dryrun/);
  });
});

describe('a company rate change recomputes the open offers — in the background', () => {
  /** The task queue: collects tasks and runs them after the current tick. */
  function queue() {
    const tasks: Array<() => Promise<unknown>> = [];
    return {
      tasks,
      enqueue: jest.fn((fn: () => Promise<unknown>) => { tasks.push(fn); return Promise.resolve().then(fn); }),
    };
  }
  function companies(rows: Row[], q = queue()) {
    const prisma = db(rows);
    prisma.company.update = jest.fn(async ({ data }: any) => data);
    prisma.company.findUnique = jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' }));
    prisma.offer.count = jest.fn(async () => 1234);
    return { svc: new CompaniesService(prisma, q as any), prisma, q };
  }
  const settle = () => new Promise((r) => setImmediate(r));

  it('costPerKm changed → queued; NEW and ASSIGNED recomputed, ACCEPTED kept as it was', async () => {
    const rows = [offer('a'), offer('b', { status: 'ASSIGNED' }), offer('c', { status: 'ACCEPTED', profitMarginPercent: 40, marginWithoutTolls: false })];
    const { svc, q } = companies(rows);
    await svc.update('c1', { costPerKm: 4.2 } as any);
    expect(q.enqueue).toHaveBeenCalledTimes(1);
    await settle();
    expect(rows.map((r) => r.profitMarginPercent)).toEqual([71.02, 71.02, 40]);
  });

  it('PATCH returns before the recompute runs (not inside the request)', async () => {
    const rows = [offer('a')];
    const never: any = { enqueue: jest.fn(() => new Promise(() => undefined)) };
    const { svc, prisma } = companies(rows, never);
    await expect(svc.update('c1', { costCurrency: 'EUR', costPerKm: 1 } as any)).resolves.toBeDefined();
    expect([never.enqueue.mock.calls.length, prisma.offer.findMany.mock.calls.length]).toEqual([1, 0]);
  });

  it('the recompute throws → PATCH still succeeds, the rate is saved, a warn names the company and the open offers', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const failing: any = { enqueue: jest.fn(() => Promise.reject(new Error('db down'))) };
      const { svc, prisma } = companies([offer('a')], failing);
      await expect(svc.update('c1', { costPerKm: 5 } as any)).resolves.toEqual({ costPerKm: 5 });
      expect(prisma.company.update).toHaveBeenCalled();
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      for (const part of ['companyId=c1', 'open offers=1234', 'db down', 'offers:recompute-economics']) expect(line).toContain(part);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['the name', { name: 'Nowa nazwa' }],
    ['the city', { city: 'Poznań' }],
  ])('a change of %s (not the rate or its currency) → nothing queued', async (_n, dto) => {
    const { svc, q } = companies([offer('a')]);
    await svc.update('c1', dto as any);
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it('costCurrency alone (a company without a rate) → queued too', async () => {
    const { svc, q, prisma } = companies([offer('a')]);
    prisma.company.findUnique = jest.fn(async () => ({ costPerKm: null, costCurrency: 'PLN' }));
    await svc.update('c1', { costCurrency: 'EUR' } as any);
    expect(q.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('the report line of the command', () => {
  it('names every count and says when nothing was written', async () => {
    const { report } = await import('../../src/cli/recompute-economics');
    const c = { offers: 4, full: 1, upperBound: 2, empty: 1, changed: 3, suspectRoutes: 2 };
    expect(report(c, true)).toBe('Offers: 4; full margin: 1; upper bound (no toll): 2; no margin: 1; suspected fallback routes ignored: 2; would change: 3 (dry run — nothing written)');
    expect(report(c, false)).toBe('Offers: 4; full margin: 1; upper bound (no toll): 2; no margin: 1; suspected fallback routes ignored: 2; changed: 3');
  });
});

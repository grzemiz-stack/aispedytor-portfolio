/**
 * The expiry task on a real Postgres.
 *
 * A mock cannot show whether the candidate query (OR on `expiresAt`, age and
 * the loading instant, the company country from the relation, cursor paging)
 * and the write guarded by status NEW work in the database. Here: the test's
 * own offers in the seed company, dates relative to "now" (nothing
 * hardcoded); seed offers — only NEW may become EXPIRED, no other status
 * changes. Run last in demo-test.sh, because it also expires the dead offers
 * of the seed.
 */
import { PrismaClient } from '@prisma/client';
import { OfferExpiryTask } from '../../src/common/tasks/offer-expiry.task';

const prisma = new PrismaClient();
const cleared: string[] = [];
const task = new OfferExpiryTask(prisma as any, { deleteByPrefix: (p: string) => cleared.push(p) } as any);
const MARK = 'EXPTEST';
const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const ahead = (days: number) => new Date(now + days * DAY);
let companyId: string;

const make = (externalId: string, over: Record<string, unknown>) => ({
  companyId, externalId: `${MARK}-${externalId}`, clientName: MARK, status: 'NEW' as const,
  pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
  pickupDate: ahead(3), createdAt: ago(1), ...over,
});
const statusOf = async () =>
  Object.fromEntries(
    (await prisma.offer.findMany({ where: { companyId, clientName: MARK }, select: { externalId: true, status: true } }))
      .map((o) => [o.externalId!.slice(MARK.length + 1), o.status]),
  );
const seedStatuses = async () =>
  Object.fromEntries(
    (await prisma.offer.groupBy({ by: ['status'], where: { NOT: { clientName: MARK } }, _count: true }))
      .map((g) => [g.status, g._count]),
  );

beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ select: { id: true } })).id;
  await prisma.offer.createMany({
    data: [
      make('pickup-passed', { pickupDate: ago(2) }),
      make('expires-passed', { expiresAt: ago(1 / 24) }),
      make('too-old', { createdAt: ago(8) }),
      make('outside-map', { pickupCountry: 'XX', pickupDate: ago(2) }),
      make('live', {}),
      make('live-expires-ahead', { expiresAt: ahead(1) }),
      make('assigned-pickup-passed', { status: 'ASSIGNED', pickupDate: ago(2), createdAt: ago(10) }),
      make('accepted-old', { status: 'ACCEPTED', pickupDate: ago(2), createdAt: ago(10) }),
    ],
  });
});
afterAll(async () => {
  await prisma.offer.deleteMany({ where: { companyId, clientName: MARK } });
  await prisma.$disconnect();
});

it('NEW with deadReason → EXPIRED; live NEW, ASSIGNED and ACCEPTED stay; the cache of the company cleared', async () => {
  const before = await seedStatuses();
  await task.handleExpiry();
  expect(await statusOf()).toEqual({
    'pickup-passed': 'EXPIRED',
    'expires-passed': 'EXPIRED',
    'too-old': 'EXPIRED',
    'outside-map': 'EXPIRED',
    live: 'NEW',
    'live-expires-ahead': 'NEW',
    'assigned-pickup-passed': 'ASSIGNED',
    'accepted-old': 'ACCEPTED',
  });
  expect(cleared).toContain(`offers:${companyId}`);
  // Seed offers: only NEW → EXPIRED; the other statuses unchanged.
  const after = await seedStatuses();
  const moved = (before.NEW ?? 0) - (after.NEW ?? 0);
  expect(moved).toBeGreaterThanOrEqual(0);
  expect({ ...after, NEW: undefined, EXPIRED: (after.EXPIRED ?? 0) - moved }).toEqual({ ...before, NEW: undefined, EXPIRED: before.EXPIRED ?? 0 });
});

it('more than one page (2500 dead NEW + live ones between them): one run expires every dead one, keeps the live ones (W12)', async () => {
  // Paging with a Prisma cursor and `skip: 1` lost one offer at every page boundary.
  const many = Array.from({ length: 2500 }, (_, i) => make(`many-${String(i).padStart(4, '0')}`, { createdAt: ago(9) }));
  const live = Array.from({ length: 50 }, (_, i) => make(`many-live-${String(i).padStart(2, '0')}`, {}));
  await prisma.offer.createMany({ data: [...many, ...live] });
  await task.handleExpiry();
  const left = await prisma.offer.groupBy({
    by: ['status'], where: { companyId, clientName: MARK, externalId: { startsWith: `${MARK}-many-` } }, _count: true,
  });
  expect(Object.fromEntries(left.map((g) => [g.status, g._count]))).toEqual({ EXPIRED: 2500, NEW: 50 });
});

it('a second run changes nothing (idempotent)', async () => {
  const before = { mine: await statusOf(), seed: await seedStatuses() };
  await task.handleExpiry();
  expect({ mine: await statusOf(), seed: await seedStatuses() }).toEqual(before);
});

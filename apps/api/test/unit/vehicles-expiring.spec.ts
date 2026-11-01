/**
 * GET /vehicles/expiring — the user id in the notification.
 *
 * The controller must pass `req.user.userId`: the `JwtStrategy.validate()`
 * contract has no `sub` field. With `undefined` instead:
 *   - the duplicate check would query `where: { userId: undefined }`, and Prisma
 *     DROPS filters whose value is undefined, so it would compare the
 *     notifications of all users;
 *   - `notification.create({ userId: undefined })` would fail validation, as the
 *     column is required.
 *
 * The test goes all the way: controller -> service -> fake table, to check
 * the value that actually lands in the row, not just the call argument.
 */
import { VehiclesController } from '../../src/vehicles/vehicles.controller';
import { VehiclesService } from '../../src/vehicles/vehicles.service';
import type { AuthenticatedRequest } from '../../src/common/types/authenticated-request';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const VEHICLE = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'WA 12345',
  technicalInspectionTo: null,
  insuranceTo: daysFromNow(5),
  tachographLegalizationTo: null,
  plannedMaintenanceDate: null,
  fuelCardExpiry: null,
};

function makeControler() {
  const rows: any[] = [];
  const prisma: any = {
    vehicle: { findMany: jest.fn().mockResolvedValue([{ ...VEHICLE }]) },
    notification: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find(
          (n) =>
            n.companyId === where.companyId &&
            n.userId === where.userId &&
            n.type === where.type,
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const entry = { id: `n-${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(entry);
        return entry;
      }),
    },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  const service = new VehiclesService(prisma, cache);
  return { controller: new VehiclesController(service), wiersze: rows };
}

/** A request shaped like the one JwtStrategy.validate() produces. */
const requestWithUser = (user: Record<string, unknown>) => ({ user }) as unknown as AuthenticatedRequest;

beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('findExpiring — userId in the notification', () => {
  it('the notification gets the userId from the request, not undefined', async () => {
    const { controller, wiersze: rows } = makeControler();

    await controller.findExpiring(
      requestWithUser({ userId: 'user-123', companyId: 'comp-1', role: 'DISPATCHER', email: 'a@b.example.com' }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('user-123');
    expect(rows[0].userId).toBeDefined();
  });

  it('companyId also comes from the request', async () => {
    const { controller, wiersze: rows } = makeControler();

    await controller.findExpiring(
      requestWithUser({ userId: 'user-123', companyId: 'comp-1', role: 'DISPATCHER', email: 'a@b.example.com' }),
    );

    expect(rows[0].companyId).toBe('comp-1');
  });

  it('a `sub` field outside the contract is not used as the user id', async () => {
    // If the controller went back to reading `sub`, this test would catch it.
    const { controller, wiersze: rows } = makeControler();

    await controller.findExpiring(
      requestWithUser({
        userId: 'user-123',
        sub: 'NIE-TO-POLE',
        companyId: 'comp-1',
        role: 'DISPATCHER',
        email: 'a@b.example.com',
      }),
    );

    expect(rows[0].userId).toBe('user-123');
    expect(rows[0].userId).not.toBe('NIE-TO-POLE');
  });

  it('the duplicate check tells users apart — each user gets their own notification', async () => {
    // With `userId: undefined` Prisma would drop this filter, so the second user
    // would not get a notification of their own.
    const { controller, wiersze: rows } = makeControler();
    const baseUser = { companyId: 'comp-1', role: 'DISPATCHER', email: 'a@b.example.com' };

    await controller.findExpiring(requestWithUser({ ...baseUser, userId: 'user-1' }));
    await controller.findExpiring(requestWithUser({ ...baseUser, userId: 'user-2' }));

    expect(rows.map((entry) => entry.userId)).toEqual(['user-1', 'user-2']);
  });

  it('the same user does not get a duplicate', async () => {
    const { controller, wiersze: rows } = makeControler();
    const req = requestWithUser({ userId: 'user-1', companyId: 'comp-1', role: 'DISPATCHER', email: 'a@b.example.com' });

    await controller.findExpiring(req);
    await controller.findExpiring(req);

    expect(rows).toHaveLength(1);
  });
});

/**
 * DriversService: always the caller's company (another company's driver or
 * vehicle answers like an unknown one), single-crew assignment to power
 * units only, the manual status as written, availability through the
 * activity gateway.
 *
 * The Prisma stub keeps rows in memory and applies the `where` filters the
 * service sends, so a missing `companyId` shows up as a leak.
 */
import { Prisma } from '@prisma/client';
import { DriversService, statusProblem } from '../../../src/fleet-planning/drivers.service';
import type { CreateDriverStatusDto } from '../../../src/fleet-planning/dto/create-driver-status.dto';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { FakeDriverActivityProvider } from '../../fakes/fake-driver-activity-provider';
import { HistoryBuilder } from '../../fixtures/driver-history';
import { d, status } from '../../fixtures/driver-status';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !matches(row, v);
    return row[k] === v;
  });
}

function stub() {
  const db = {
    drivers: [] as Row[],
    vehicles: [
      { id: 'truck-a', companyId: 'A', plateNumber: 'PO 1', vehicleCategory: 'TRUCK' },
      { id: 'trailer-a', companyId: 'A', plateNumber: 'PO 2', vehicleCategory: 'SEMI_TRAILER' },
      { id: 'drawbar-a', companyId: 'A', plateNumber: 'PO 3', vehicleCategory: 'TRAILER' },
      { id: 'truck-b', companyId: 'B', plateNumber: 'WA 1', vehicleCategory: 'TRUCK' },
    ] as Row[],
    statuses: [] as Row[],
    uniqueClash: false,
  };
  let n = 0;
  const withVehicle = (d: Row) => ({ ...d, vehicle: db.vehicles.find((v) => v.id === d.vehicleId) ?? null });
  const prisma = {
    driver: {
      findMany: jest.fn(async ({ where }: any) => db.drivers.filter((d) => matches(d, where)).map(withVehicle)),
      findFirst: jest.fn(async ({ where }: any) => {
        const d = db.drivers.find((x) => matches(x, where));
        return d ? withVehicle(d) : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: `driver-${++n}`, vehicleId: null, active: true, ...data };
        db.drivers.push(d);
        return withVehicle(d);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (db.uniqueClash) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        const d = db.drivers.find((x) => x.id === where.id)!;
        Object.assign(d, data);
        return withVehicle(d);
      }),
      delete: jest.fn(async ({ where }: any) => {
        db.drivers = db.drivers.filter((x) => x.id !== where.id);
      }),
    },
    vehicle: {
      findFirst: jest.fn(async ({ where }: any) => db.vehicles.find((v) => matches(v, where)) ?? null),
    },
    driverStatus: {
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `status-${++n}`, createdAt: new Date(Date.UTC(2026, 9, 7, 8, n)), ...data };
        db.statuses.push(s);
        return s;
      }),
      findMany: jest.fn(async ({ where }: any) => db.statuses.filter((s) => matches(s, where)).sort((a, b) => b.createdAt - a.createdAt)),
    },
  };
  return { db, prisma: prisma as unknown as PrismaService & typeof prisma };
}

async function setup(provider = new FakeDriverActivityProvider()) {
  const { db, prisma } = stub();
  const service = new DriversService(prisma, provider);
  const a = await service.create('A', { firstName: 'Anna', lastName: 'Nowak' });
  const b = await service.create('B', { firstName: 'Bob', lastName: 'Smith' });
  return { db, prisma, service, a, b };
}

/** The error body the API returns. */
async function errorOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e: any) {
    return [e.getStatus?.(), e.getResponse?.().code, e.getResponse?.().params];
  }
}

const STATUS: CreateDriverStatusDto = {
  weeklyRestEndedAt: '2026-10-05T06:00:00Z',
  weeklyRestType: 'REGULAR',
  drivingThisWeekMinutes: 900,
  drivingLastWeekMinutes: 2400,
  lastHomeRestEndedAt: '2026-10-05T06:00:00Z',
};

describe('company scope', () => {
  it('the company comes from the token, never from the body', async () => {
    const { a } = await setup();
    expect(a.companyId).toBe('A');
  });

  it('list: only the own company, optionally only active', async () => {
    const { service, a } = await setup();
    await service.update(a.id, 'A', { active: false });
    expect((await service.findAll('A')).map((d) => d.firstName)).toEqual(['Anna']);
    expect(await service.findAll('A', true)).toEqual([]);
  });

  it.each([
    ['findOne', (s: DriversService, id: string) => s.findOne(id, 'A')],
    ['update', (s: DriversService, id: string) => s.update(id, 'A', { firstName: 'X' })],
    ['remove', (s: DriversService, id: string) => s.remove(id, 'A')],
    ['assignVehicle', (s: DriversService, id: string) => s.assignVehicle(id, 'A', null)],
    ['addStatus', (s: DriversService, id: string) => s.addStatus(id, 'A', 'user-1', STATUS)],
    ['statusHistory', (s: DriversService, id: string) => s.statusHistory(id, 'A')],
    ['availability', (s: DriversService, id: string) => s.availability(id, 'A', {})],
  ])('%s on another company’s driver → 404 DRIVER_NOT_FOUND, the same as an unknown id; nothing written', async (_name, call) => {
    const { service, b, db, prisma } = await setup();
    const foreign = await errorOf(call(service, b.id));
    const unknown = await errorOf(call(service, 'no-such-driver'));
    expect([foreign, unknown]).toEqual([[404, 'DRIVER_NOT_FOUND', undefined], [404, 'DRIVER_NOT_FOUND', undefined]]);
    expect([prisma.driver.update, prisma.driver.delete, prisma.driverStatus.create].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    expect(db.drivers.find((d) => d.id === b.id)?.firstName).toBe('Bob');
  });
});

describe('assignment to a vehicle (single crew, power units only)', () => {
  it('own truck: assigned', async () => {
    const { service, a } = await setup();
    expect((await service.assignVehicle(a.id, 'A', 'truck-a')).vehicle?.plateNumber).toBe('PO 1');
  });

  it('another company’s truck → 404 DRIVER_VEHICLE_NOT_FOUND', async () => {
    const { service, a } = await setup();
    expect(await errorOf(service.assignVehicle(a.id, 'A', 'truck-b'))).toEqual([404, 'DRIVER_VEHICLE_NOT_FOUND', undefined]);
  });

  it.each([['SEMI_TRAILER', 'trailer-a'], ['TRAILER', 'drawbar-a']])('a %s → 422 DRIVER_VEHICLE_NOT_A_POWER_UNIT', async (category, id) => {
    const { service, a } = await setup();
    expect(await errorOf(service.assignVehicle(a.id, 'A', id))).toEqual([422, 'DRIVER_VEHICLE_NOT_A_POWER_UNIT', { vehicleCategory: category }]);
  });

  it('a truck another driver has → 409 DRIVER_VEHICLE_ALREADY_ASSIGNED', async () => {
    const { service, a } = await setup();
    const c = await service.create('A', { firstName: 'Celina', lastName: 'Lis' });
    await service.assignVehicle(a.id, 'A', 'truck-a');
    expect(await errorOf(service.assignVehicle(c.id, 'A', 'truck-a'))).toEqual([409, 'DRIVER_VEHICLE_ALREADY_ASSIGNED', { driverId: a.id }]);
  });

  it('the same driver again: fine; null unassigns', async () => {
    const { service, a } = await setup();
    await service.assignVehicle(a.id, 'A', 'truck-a');
    await service.assignVehicle(a.id, 'A', 'truck-a');
    expect((await service.assignVehicle(a.id, 'A', null)).vehicleId).toBeNull();
  });

  it('two assignments at once: the unique index answers 409', async () => {
    const { service, a, db } = await setup();
    db.uniqueClash = true;
    expect(await errorOf(service.assignVehicle(a.id, 'A', 'truck-a'))).toEqual([409, 'DRIVER_VEHICLE_ALREADY_ASSIGNED', undefined]);
  });
});

describe('manual status', () => {
  it('stored as given, with who entered it; defaults filled; asOf = now when omitted; omitted compensation = unknown (null), not 0', async () => {
    const { service, a } = await setup();
    const now = new Date('2026-10-07T09:00:00Z');
    const s = await service.addStatus(a.id, 'A', 'user-1', { ...STATUS, recentWeeklyRests: [{ type: 'REGULAR', endedAt: '2026-10-05T08:00:00+02:00', abroad: false }] }, now);
    expect([s.enteredById, s.asOf, s.weeklyRestAbroad, s.compensationOwedMinutes, s.extendedDrivingDaysUsed, s.recentWeeklyRests])
      .toEqual(['user-1', now, false, null, null, [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00.000Z', abroad: false }]]);
  });

  it('weekly rest type and the last rest at home omitted → stored as unknown (null)', async () => {
    const { service, a } = await setup();
    const s = await service.addStatus(a.id, 'A', 'user-1', { ...STATUS, weeklyRestType: undefined, lastHomeRestEndedAt: undefined });
    expect([s.weeklyRestType, s.lastHomeRestEndedAt]).toEqual([null, null]);
  });

  it('onDuty omitted → stored as unknown (null); false and true kept', async () => {
    const { service, a } = await setup();
    const omitted = await service.addStatus(a.id, 'A', 'user-1', STATUS);
    const resting = await service.addStatus(a.id, 'A', 'user-1', { ...STATUS, onDuty: false });
    expect([omitted.onDuty, resting.onDuty]).toEqual([null, false]);
  });

  it('no list of recent weekly rests → database NULL (unknown), not an empty list', async () => {
    const { service, a } = await setup();
    expect((await service.addStatus(a.id, 'A', 'user-1', STATUS)).recentWeeklyRests).toBe(Prisma.DbNull);
  });

  it('inconsistent → 400 DRIVER_STATUS_INVALID with the field', async () => {
    const { service, a, prisma } = await setup();
    expect(await errorOf(service.addStatus(a.id, 'A', 'user-1', { ...STATUS, compensationOwedMinutes: 60 }))).toEqual([400, 'DRIVER_STATUS_INVALID', { field: 'compensationDueBy' }]);
    expect(prisma.driverStatus.create).not.toHaveBeenCalled();
  });

  it('history: newest first, the first is current', async () => {
    const { service, a } = await setup();
    await service.addStatus(a.id, 'A', 'user-1', { ...STATUS, drivingThisWeekMinutes: 1 });
    await service.addStatus(a.id, 'A', 'user-1', { ...STATUS, drivingThisWeekMinutes: 2 });
    const h = await service.statusHistory(a.id, 'A');
    expect([h.current?.drivingThisWeekMinutes, h.history.map((x) => x.drivingThisWeekMinutes)]).toEqual([2, [2, 1]]);
  });
});

describe('statusProblem (cross-field rules)', () => {
  const shift = { onDuty: true, dailyRestEndedAt: '2026-10-07T05:00:00Z', drivingSinceDailyRestMinutes: 120, drivingSinceBreakMinutes: 60, workSinceBreakMinutes: 90 };
  it.each([
    ['consistent', {}, null],
    ['consistent, on duty', shift, null],
    ['compensation without a deadline', { compensationOwedMinutes: 60 }, 'compensationDueBy'],
    ['a deadline without the compensation', { compensationDueBy: '2026-10-26T00:00:00Z' }, 'compensationOwedMinutes'],
    ['unavailable without a reason', { unavailableUntil: '2026-10-09T00:00:00Z' }, 'unavailableReason'],
    ['a reason without an end', { unavailableReason: 'LEAVE' as const }, 'unavailableUntil'],
    ['on duty without a counter', { ...shift, workSinceBreakMinutes: undefined }, 'workSinceBreakMinutes'],
    ['counters without onDuty', { drivingSinceBreakMinutes: 10 }, 'onDuty'],
    ['on duty, counters without the daily rest', { onDuty: true, drivingSinceBreakMinutes: 10 }, 'dailyRestEndedAt'],
    ['onDuty true without the duty block', { onDuty: true }, 'dailyRestEndedAt'],
    ['the duty block with onDuty false', { ...shift, onDuty: false }, 'onDuty'],
    ['the duty block with onDuty omitted (unknown)', { ...shift, onDuty: undefined }, 'onDuty'],
    ['resting (onDuty false)', { onDuty: false }, null],
    ['daily rest before the weekly rest', { ...shift, dailyRestEndedAt: '2026-10-04T05:00:00Z' }, 'dailyRestEndedAt'],
    ['more since the break than since the rest', { ...shift, drivingSinceBreakMinutes: 121 }, 'drivingSinceBreakMinutes'],
    ['recent list not starting with the last weekly rest', { recentWeeklyRests: [{ type: 'REDUCED' as const, endedAt: '2026-10-05T06:00:00Z', abroad: false }] }, 'recentWeeklyRests'],
    ['recent list not newest first', { recentWeeklyRests: [{ type: 'REGULAR' as const, endedAt: '2026-10-05T06:00:00Z', abroad: false }, { type: 'REGULAR' as const, endedAt: '2026-10-06T06:00:00Z', abroad: false }] }, 'recentWeeklyRests'],
  ])('%s → %s', (_name, change, field) => {
    expect(statusProblem({ ...STATUS, ...change } as CreateDriverStatusDto)).toBe(field);
  });
});

describe('availability through the gateway', () => {
  it('no status yet → 409 DRIVER_STATUS_MISSING', async () => {
    const { service, a } = await setup();
    expect(await errorOf(service.availability(a.id, 'A', {}))).toEqual([409, 'DRIVER_STATUS_MISSING', undefined]);
  });

  it('the provider’s status is used; the answer names the source', async () => {
    const provider = new FakeDriverActivityProvider();
    const { service, a } = await setup(provider);
    (provider as any).statuses[a.id] = status();
    const r = await service.availability(a.id, 'A', { at: '2026-10-07T08:00:00Z' });
    expect([r.source, r.canDepartFrom.toISOString(), r.drivingLeft.total]).toEqual(['fake', '2026-10-07T08:00:00.000Z', 540]);
  });

  it('the provider’s status lacks a deadline that cannot be derived → 409 DRIVER_STATUS_INCOMPLETE naming the field', async () => {
    const provider = new FakeDriverActivityProvider();
    const { service, a } = await setup(provider);
    (provider as any).statuses[a.id] = status({ compensationOwedMinutes: 600, compensationDueBy: null });
    expect(await errorOf(service.availability(a.id, 'A', { at: '2026-10-07T08:00:00Z' }))).toEqual([409, 'DRIVER_STATUS_INCOMPLETE', { field: 'compensationDueBy' }]);
  });

  it('a provider building its status from a history without a weekly rest → 409 DRIVER_STATUS_INCOMPLETE, not 500', async () => {
    const b = new HistoryBuilder('2026-09-28T06:00:00Z');
    for (let i = 0; i < 9; i++) b.day9('PL').rest(14 * 60 + 15, 'PL');
    // Covered from Monday 28.9 00:00: nine days of 9 h with 14 h 15 min rests, no rest of 24 h.
    const provider = new FakeDriverActivityProvider({}, {}, { coveredFrom: d('2026-09-28T00:00:00Z'), statusFromHistory: { establishmentCountry: 'PL', asOf: d('2026-10-07T06:00:00Z') } });
    const { service, a } = await setup(provider);
    (provider as any).activities[a.id] = b.activities;
    expect(await errorOf(service.availability(a.id, 'A', { at: '2026-10-07T06:00:00Z' }))).toEqual([409, 'DRIVER_STATUS_INCOMPLETE', { field: 'weeklyRestEndedAt' }]);
  });

  it('the provider fails for its source → 502 DRIVER_ACTIVITY_PROVIDER_FAILED with its reason, not 500', async () => {
    const provider = new FakeDriverActivityProvider({}, {}, { failing: true });
    const { service, a } = await setup(provider);
    expect(await errorOf(service.availability(a.id, 'A', {}))).toEqual([502, 'DRIVER_ACTIVITY_PROVIDER_FAILED', { reason: 'unavailable' }]);
  });

  it('another company’s driver: the provider is not asked', async () => {
    const provider = new FakeDriverActivityProvider();
    const spy = jest.spyOn(provider, 'currentStatus');
    const { service, b } = await setup(provider);
    await errorOf(service.availability(b.id, 'A', {}));
    expect(spy).not.toHaveBeenCalled();
  });
});

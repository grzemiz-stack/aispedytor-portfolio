/**
 * VehiclesService — document expiry dates, notifications, field mapping.
 *
 * Tested is what carries logic: counting days to expiry, severity
 * thresholds, the 30-day filter, notification deduplication and the defaults
 * when a vehicle is created. `delete` and `findOne` are thin delegates —
 * not covered here except for one not-found test.
 *
 * The Prisma fake follows PostgreSQL semantics: empty fields are `null`, and the
 * duplicate-check query (`contains` + `gte`) runs on the actual table contents.
 */
import { VehiclesService } from '../../src/vehicles/vehicles.service';

const NOW = new Date('2026-06-01T12:00:00.000Z');

/** A date `days` away from the fixed "now". */
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

/** A vehicle with all document fields set to NULL. */
const VEHICLE = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'WA 12345',
  technicalInspectionTo: null,
  insuranceTo: null,
  tachographLegalizationTo: null,
  plannedMaintenanceDate: null,
  fuelCardExpiry: null,
};

/**
 * Fake `notification` table with the semantics of the query the service uses:
 * equality on companyId/userId/type, `contains` on message, `gte` on createdAt.
 */
function makeNotificationTable() {
  const rows: any[] = [];
  return {
    wiersze: rows,
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        rows.find((n) =>
          n.companyId === where.companyId &&
          n.userId === where.userId &&
          n.type === where.type &&
          (where.message?.contains == null || String(n.message).includes(where.message.contains)) &&
          (where.createdAt?.gte == null || n.createdAt >= where.createdAt.gte),
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `notif-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
  };
}

function makeService(fleetVehicles: any[] = []) {
  const notification = makeNotificationTable();
  const prisma: any = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue(fleetVehicles),
      count: jest.fn().mockResolvedValue(fleetVehicles.length),
      findFirst: jest.fn().mockResolvedValue(fleetVehicles[0] ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'nowy', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'veh-1', ...data })),
      delete: jest.fn().mockResolvedValue({ id: 'veh-1' }),
    },
    notification,
  };
  const cache: any = {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    deleteByPrefix: jest.fn(),
  };
  return { service: new VehiclesService(prisma, cache), prisma, cache, notification };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('findExpiring — which documents make the list', () => {
  it('a vehicle without any dates is not listed', async () => {
    const { service } = makeService([{ ...VEHICLE }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result).toEqual([]);
  });

  it('a document expiring in 31 days does not warn yet', async () => {
    const { service } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(31) }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result).toEqual([]);
  });

  it('a document expiring in 30 days warns', async () => {
    const { service } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(30) }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0].expiryWarnings[0].field).toBe('insuranceTo');
  });

  it.each([
    [1, 'critical'],
    [7, 'critical'],
    [8, 'warning'],
    [30, 'warning'],
  ])('in %i days the severity is %s', async (days, severity) => {
    const { service } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(days) }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result[0].expiryWarnings[0].severity).toBe(severity);
  });

  it('an already expired document is critical, not left out', async () => {
    const { service } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(-10) }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result[0].expiryWarnings[0].severity).toBe('critical');
    expect(result[0].expiryWarnings[0].daysLeft).toBeLessThan(0);
  });

  it('all five document types are checked', async () => {
    const { service } = makeService([{
      ...VEHICLE,
      technicalInspectionTo: daysFromNow(5),
      insuranceTo: daysFromNow(5),
      tachographLegalizationTo: daysFromNow(5),
      plannedMaintenanceDate: daysFromNow(5),
      fuelCardExpiry: daysFromNow(5),
    }]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result[0].expiryWarnings.map((entry: any) => entry.field).sort()).toEqual([
      'fuelCardExpiry',
      'insuranceTo',
      'plannedMaintenanceDate',
      'tachographLegalizationTo',
      'technicalInspectionTo',
    ]);
  });

  it('vehicles without warnings are filtered out of the result', async () => {
    const { service } = makeService([
      { ...VEHICLE, id: 'a', plateNumber: 'AAA', insuranceTo: daysFromNow(5) },
      { ...VEHICLE, id: 'b', plateNumber: 'BBB' },
    ]);
    const result = await service.findExpiring('comp-1', 'user-1');

    expect(result.map((v: any) => v.id)).toEqual(['a']);
  });
});

describe('notifications about expiring documents', () => {
  it('a warning creates a notification with the registration number', async () => {
    const { service, notification } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(5) }]);
    await service.findExpiring('comp-1', 'user-1');

    expect(notification.wiersze).toHaveLength(1);
    expect(notification.wiersze[0].type).toBe('VEHICLE_INSURANCE_EXPIRY');
    expect(notification.wiersze[0].message).toContain('WA 12345');
  });

  it('the same warning does not create a second notification', async () => {
    const { service, notification } = makeService([{ ...VEHICLE, insuranceTo: daysFromNow(5) }]);
    await service.findExpiring('comp-1', 'user-1');
    await service.findExpiring('comp-1', 'user-1');

    expect(notification.wiersze).toHaveLength(1);
  });

  it('different vehicles get separate notifications', async () => {
    const { service, notification } = makeService([
      { ...VEHICLE, id: 'a', plateNumber: 'AAA 111', insuranceTo: daysFromNow(5) },
      { ...VEHICLE, id: 'b', plateNumber: 'BBB 222', insuranceTo: daysFromNow(5) },
    ]);
    await service.findExpiring('comp-1', 'user-1');

    expect(notification.wiersze).toHaveLength(2);
  });

  it('different document types give separate notifications', async () => {
    const { service, notification } = makeService([{
      ...VEHICLE,
      insuranceTo: daysFromNow(5),
      technicalInspectionTo: daysFromNow(5),
    }]);
    await service.findExpiring('comp-1', 'user-1');

    expect(notification.wiersze.map((n: any) => n.type).sort()).toEqual([
      'VEHICLE_INSPECTION_EXPIRY',
      'VEHICLE_INSURANCE_EXPIRY',
    ]);
  });

  it('the fuel card has its own notification type and is not suppressed by insurance', async () => {
    // `fuelCardExpiry` must not share the type 'VEHICLE_INSURANCE_EXPIRY' with `insuranceTo`:
    // deduplication compares (type, message contains plateNumber), so the insurance
    // notification would suppress the fuel card one for the same vehicle.
    const { service, notification } = makeService([{
      ...VEHICLE,
      insuranceTo: daysFromNow(5),
      fuelCardExpiry: daysFromNow(5),
    }]);
    await service.findExpiring('comp-1', 'user-1');

    const titles = notification.wiersze.map((n: any) => n.title);
    expect(titles.some((t: string) => t.includes('Ubezpieczenie'))).toBe(true);
    expect(titles.some((t: string) => t.includes('Karta paliwowa'))).toBe(true);
    expect(notification.wiersze.map((n: any) => n.type).sort()).toEqual([
      'VEHICLE_FUEL_CARD_EXPIRY',
      'VEHICLE_INSURANCE_EXPIRY',
    ]);
  });
});

describe('create — defaults and field mapping', () => {
  it('no category gives TRUCK', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK' } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.vehicleCategory).toBe('TRUCK');
  });

  it('a given category is not overwritten by the default', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK', vehicleCategory: 'SEMI_TRAILER' } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.vehicleCategory).toBe('SEMI_TRAILER');
  });

  it('ADR and GPS flags default to false, the ADR class list to empty', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK' } as any);

    const data = prisma.vehicle.create.mock.calls[0][0].data;
    expect(data.hasAdr).toBe(false);
    expect(data.hasGps).toBe(false);
    expect(data.adrClasses).toEqual([]);
  });

  it('hasAdr=false from the DTO is not replaced by the default', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK', hasAdr: false } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.hasAdr).toBe(false);
  });

  it('no parent vehicle is saved as NULL, not undefined', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK' } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.parentVehicleId).toBeNull();
  });

  it('dates from the DTO are converted to Date objects', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', {
      plateNumber: 'WA 1', vehicleType: 'TRUCK', insuranceTo: '2026-12-31',
    } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.insuranceTo).toBeInstanceOf(Date);
  });

  it('a missing date is saved as NULL', async () => {
    const { service, prisma } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK' } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data.insuranceTo).toBeNull();
  });

  it('gross vehicle weight and curb weight can be set through the API', async () => {
    // Without this mapping the gross-weight check would block the LTL path for
    // good — there would be no way to enter the data it requires.
    const { service, prisma } = makeService();
    await service.create('comp-1', {
      plateNumber: 'WA 1', vehicleType: 'TRUCK',
      grossVehicleWeightKg: 40000, curbWeightKg: 15000,
    } as any);

    expect(prisma.vehicle.create.mock.calls[0][0].data).toMatchObject({
      grossVehicleWeightKg: 40000,
      curbWeightKg: 15000,
    });
  });

  it('creating a vehicle invalidates the company cache', async () => {
    const { service, cache } = makeService();
    await service.create('comp-1', { plateNumber: 'WA 1', vehicleType: 'TRUCK' } as any);

    expect(cache.deleteByPrefix).toHaveBeenCalledWith('vehicles:comp-1');
  });
});

describe('update — only the fields actually given', () => {
  it('a field absent from the DTO is not sent in the query', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { brand: 'Volvo' } as any);

    const data = prisma.vehicle.update.mock.calls[0][0].data;
    expect(data).toHaveProperty('brand', 'Volvo');
    expect(data).not.toHaveProperty('model');
    expect(data).not.toHaveProperty('status');
  });

  it('an explicit null clears the field — not the same as omitting it', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { notes: null } as any);

    expect(prisma.vehicle.update.mock.calls[0][0].data).toHaveProperty('notes', null);
  });

  it('an empty parentVehicleId is saved as NULL', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { parentVehicleId: '' } as any);

    expect(prisma.vehicle.update.mock.calls[0][0].data.parentVehicleId).toBeNull();
  });

  it('a date set to null clears the column instead of giving Invalid Date', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { insuranceTo: null } as any);

    expect(prisma.vehicle.update.mock.calls[0][0].data.insuranceTo).toBeNull();
  });

  it('gross vehicle weight and curb weight can be updated', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { grossVehicleWeightKg: 42000 } as any);

    const data = prisma.vehicle.update.mock.calls[0][0].data;
    expect(data).toHaveProperty('grossVehicleWeightKg', 42000);
    expect(data).not.toHaveProperty('curbWeightKg'); // an omitted field is not sent in the query
  });

  it('curb weight 0 is sent as 0, not treated as omitted', async () => {
    const { service, prisma } = makeService([{ ...VEHICLE }]);
    await service.update('veh-1', 'comp-1', { curbWeightKg: 0 } as any);

    expect(prisma.vehicle.update.mock.calls[0][0].data).toHaveProperty('curbWeightKg', 0);
  });

  it('updating a missing vehicle throws NotFound', async () => {
    const { service } = makeService([]);

    await expect(service.update('brak', 'comp-1', { brand: 'X' } as any)).rejects.toThrow(
      /nie znaleziony/i,
    );
  });
});

describe('findAll — filters and cache', () => {
  it('a cached result is returned without a database query', async () => {
    const { service, prisma, cache } = makeService();
    cache.get.mockReturnValue({ data: ['z cache'], meta: {} });

    const result = await service.findAll('comp-1', {} as any);

    expect(result).toEqual({ data: ['z cache'], meta: {} });
    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
  });

  it('query filters go into the WHERE condition', async () => {
    const { service, prisma } = makeService();
    await service.findAll('comp-1', {} as any, { status: 'AVAILABLE' as any, vehicleCategory: 'TRUCK' });

    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'comp-1',
      status: 'AVAILABLE',
      vehicleCategory: 'TRUCK',
    });
  });

  it('without narrowing filters only companyId remains', async () => {
    const { service, prisma } = makeService();
    await service.findAll('comp-1', {} as any);

    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual({ companyId: 'comp-1' });
  });

  it('a sort field outside the allow-list falls back to createdAt', async () => {
    const { service, prisma } = makeService();
    await service.findAll('comp-1', { sortBy: 'DROP TABLE vehicles', sortOrder: 'asc' } as any);

    expect(prisma.vehicle.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });

  it('a sort field from the allow-list is respected', async () => {
    const { service, prisma } = makeService();
    await service.findAll('comp-1', { sortBy: 'plateNumber', sortOrder: 'asc' } as any);

    expect(prisma.vehicle.findMany.mock.calls[0][0].orderBy).toEqual({ plateNumber: 'asc' });
  });

  it('pagination is converted to skip/take', async () => {
    const { service, prisma } = makeService();
    await service.findAll('comp-1', { page: 3, limit: 10 } as any);

    expect(prisma.vehicle.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
  });

  it('the result is stored in the cache', async () => {
    const { service, cache } = makeService();
    await service.findAll('comp-1', {} as any);

    expect(cache.set).toHaveBeenCalled();
  });
});

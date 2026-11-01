/**
 * Request validation of the drivers API, through the global ValidationPipe
 * with the settings of main.ts (whitelist, forbidNonWhitelisted, transform).
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AssignVehicleDto } from '../../../src/fleet-planning/dto/assign-vehicle.dto';
import { AvailabilityQueryDto } from '../../../src/fleet-planning/dto/availability-query.dto';
import { CreateDriverStatusDto } from '../../../src/fleet-planning/dto/create-driver-status.dto';
import { CreateDriverDto } from '../../../src/fleet-planning/dto/create-driver.dto';
import { UpdateDriverDto } from '../../../src/fleet-planning/dto/update-driver.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function check(metatype: new () => object, value: object, type: 'body' | 'query' = 'body'): Promise<'ok' | 400> {
  try {
    await pipe.transform(value, { type, metatype, data: '' });
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return 400;
  }
}

const STATUS = {
  weeklyRestEndedAt: '2026-10-05T06:00:00Z',
  weeklyRestType: 'REGULAR',
  drivingThisWeekMinutes: 900,
  drivingLastWeekMinutes: 2400,
  lastHomeRestEndedAt: '2026-10-05T06:00:00Z',
};

describe('POST /drivers', () => {
  it.each([
    ['first and last name', { firstName: 'Jan', lastName: 'Kowalski' }, 'ok'],
    ['with everything', { firstName: 'Jan', lastName: 'Kowalski', phone: '+48 600', email: 'jan@example.com', homeCity: 'Poznań', homeCountry: 'PL', active: true }, 'ok'],
    ['no last name', { firstName: 'Jan' }, 400],
    ['empty first name', { firstName: '', lastName: 'K' }, 400],
    ['country in lower case', { firstName: 'Jan', lastName: 'K', homeCountry: 'pl' }, 400],
    ['bad e-mail', { firstName: 'Jan', lastName: 'K', email: 'jan' }, 400],
    ['a field outside the schema', { firstName: 'Jan', lastName: 'K', companyId: 'other' }, 400],
  ])('%s → %s', async (_n, body, expected) => {
    expect(await check(CreateDriverDto, body)).toBe(expected);
  });

  it('PATCH: every field optional, the same rules', async () => {
    expect([await check(UpdateDriverDto, {}), await check(UpdateDriverDto, { homeCountry: 'pl' })]).toEqual(['ok', 400]);
  });
});

describe('PUT /drivers/:id/vehicle', () => {
  it.each([
    ['a vehicle id', { vehicleId: 'truck-a' }, 'ok'],
    ['null (unassign)', { vehicleId: null }, 'ok'],
    ['missing', {}, 400],
    ['empty', { vehicleId: '' }, 400],
    ['a number', { vehicleId: 5 }, 400],
  ])('%s → %s', async (_n, body, expected) => {
    expect(await check(AssignVehicleDto, body)).toBe(expected);
  });
});

describe('POST /drivers/:id/status', () => {
  it.each([
    ['the required fields', STATUS, 'ok'],
    ['with the recent weekly rests', { ...STATUS, recentWeeklyRests: [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00Z', abroad: false }] }, 'ok'],
    ['without the weekly rest end', { ...STATUS, weeklyRestEndedAt: undefined }, 400],
    ['an unknown rest type', { ...STATUS, weeklyRestType: 'LONG' }, 400],
    ['not ISO 8601', { ...STATUS, weeklyRestEndedAt: '05.10.2026 06:00' }, 400],
    ['minutes not whole', { ...STATUS, drivingThisWeekMinutes: 10.5 }, 400],
    ['more than a week of driving', { ...STATUS, drivingThisWeekMinutes: 10081 }, 400],
    ['negative', { ...STATUS, drivingLastWeekMinutes: -1 }, 400],
    ['compensation above two reductions', { ...STATUS, compensationOwedMinutes: 2521, compensationDueBy: '2026-10-26T00:00:00Z' }, 400],
    ['four recent weekly rests', { ...STATUS, recentWeeklyRests: Array(4).fill({ type: 'REGULAR', endedAt: '2026-10-05T06:00:00Z', abroad: false }) }, 400],
    ['an empty recent list', { ...STATUS, recentWeeklyRests: [] }, 400],
    ['a recent rest without abroad', { ...STATUS, recentWeeklyRests: [{ type: 'REGULAR', endedAt: '2026-10-05T06:00:00Z' }] }, 400],
    ['an unknown unavailability reason', { ...STATUS, unavailableUntil: '2026-10-09T00:00:00Z', unavailableReason: 'HOLIDAY' }, 400],
    ['a field outside the schema', { ...STATUS, driverId: 'x' }, 400],
    ['onDuty true / false', { ...STATUS, onDuty: false }, 'ok'],
    ['onDuty not a boolean', { ...STATUS, onDuty: 'yes' }, 400],
  ])('%s → %s', async (_n, body, expected) => {
    expect(await check(CreateDriverStatusDto, body)).toBe(expected);
  });
});

describe('POST /drivers/:id/status: required values and unknown ones (docs/decisions.md §11)', () => {
  /** The 400 messages of the pipe (class-validator), or [] when valid. */
  async function messages(value: object): Promise<string[]> {
    try {
      await pipe.transform(value, { type: 'body', metatype: CreateDriverStatusDto, data: '' });
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return ((e as BadRequestException).getResponse() as { message: string[] }).message;
    }
  }

  it.each(['drivingThisWeekMinutes', 'drivingLastWeekMinutes', 'weeklyRestEndedAt'])('%s missing → 400 naming the field, never a silent 0', async (field) => {
    const msgs = await messages({ ...STATUS, [field]: undefined });
    expect([msgs.length > 0, msgs.every((m) => m.startsWith(`${field} `))]).toEqual([true, true]);
  });

  it.each(['weeklyRestType', 'lastHomeRestEndedAt', 'compensationOwedMinutes'])('%s omitted → valid (unknown)', async (field) => {
    expect(await messages({ ...STATUS, [field]: undefined })).toEqual([]);
  });
});

describe('GET /drivers/:id/availability', () => {
  it.each([
    ['nothing', {}, 'ok'],
    ['a moment and a strategy', { at: '2026-10-07T08:00:00Z', strategy: 'earliest' }, 'ok'],
    ['an unknown strategy', { strategy: 'fastest' }, 400],
    ['not a date', { at: 'tomorrow' }, 400],
  ])('%s → %s', async (_n, query, expected) => {
    expect(await check(AvailabilityQueryDto, query, 'query')).toBe(expected);
  });
});

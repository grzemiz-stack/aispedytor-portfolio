/**
 * Dates and amounts on input: 400 naming the field instead of 500
 * (`profitEstimate` is no longer a request field).
 *
 * Before: the dates of demands and vehicles were checked only as a string
 * (`@IsString`) — "jutro" passed, `new Date('jutro')` = Invalid Date and
 * Prisma ended the request with 500. An offer's `profitEstimate` had no
 * limits — 100,000,000 overflowed DECIMAL(10,2) → 500. Now: an ISO 8601 date
 * (an empty string still clears the field — that is what the vehicle form
 * sends), an amount within the column range.
 *
 * Kept for the future: every `new Date(dto.X)` in the services must have its
 * field in the list below — a new date field without a test = a red test.
 */
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDemandDto } from '../../src/demands/dto/create-demand.dto';
import { UpdateDemandDto } from '../../src/demands/dto/update-demand.dto';
import { CreateVehicleDto } from '../../src/vehicles/dto/create-vehicle.dto';
import { UpdateVehicleDto } from '../../src/vehicles/dto/update-vehicle.dto';
import { CreateOfferDto } from '../../src/offers/dto/create-offer.dto';

const errorsOn = async (cls: any, body: object) =>
  (await validate(plainToInstance(cls, body), { skipMissingProperties: true })).map((e) => e.property);

const VEHICLE_DATES = ['technicalInspectionFrom', 'technicalInspectionTo', 'insuranceFrom', 'insuranceTo', 'tachographLegalizationFrom', 'tachographLegalizationTo', 'plannedMaintenanceDate', 'fuelCardExpiry'];
const CASES: [string, any, string][] = [
  ['CreateDemandDto', CreateDemandDto, 'neededBy'],
  ['UpdateDemandDto', UpdateDemandDto, 'neededBy'],
  ...VEHICLE_DATES.map((f) => ['CreateVehicleDto', CreateVehicleDto, f] as [string, any, string]),
  ...VEHICLE_DATES.map((f) => ['UpdateVehicleDto', UpdateVehicleDto, f] as [string, any, string]),
  ['UpdateVehicleDto', UpdateVehicleDto, 'availableFrom'],
];

describe.each(CASES)('%s.%s', (_name, cls, field) => {
  it.each(['jutro', '2026-13-45', '2026-02-31', '32.10.2026'])('%p → 400 on that field', async (v) => {
    expect(await errorsOn(cls, { [field]: v })).toContain(field);
  });
  it.each(['2026-10-10', '2026-10-10T08:00:00Z'])('%p → passes', async (v) => {
    expect(await errorsOn(cls, { [field]: v })).not.toContain(field);
  });
});

it('an empty string still clears a vehicle date (the vehicle form sends "")', async () => {
  for (const f of VEHICLE_DATES) expect(await errorsOn(UpdateVehicleDto, { [f]: '' })).not.toContain(f);
});

it('every `new Date(dto.X)` in the services has its date field tested here', () => {
  const dir = resolve(__dirname, '../../src');
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith('.service.ts') && files.push(p); });
  walk(dir);
  const used = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/new Date\(dto\.(\w+)\)/g)) used.add(m[1]);
  // The offer, driver status and e-mail dates already had @IsDateString / @IsISO8601 (tested in their own specs).
  const ALREADY_STRICT = ['pickupDate', 'deliveryDate', 'expiresAt', 'weeklyRestEndedAt', 'receivedAt'];
  const tested = new Set([...CASES.map((c) => c[2]), ...ALREADY_STRICT]);
  expect([...used].filter((f) => !tested.has(f)).sort()).toEqual([]);
});

// `profitEstimate` is no longer a request field: a client cannot send it, so it
// cannot overflow the column; the field's refusal — offers-forms.spec.ts.
it('CreateOfferDto has no profitEstimate any more (it cannot overflow the column from a request)', () => {
  expect(Object.getOwnPropertyNames(new CreateOfferDto())).not.toContain('profitEstimate');
  expect(readFileSync(resolve(__dirname, '../../src/offers/dto/create-offer.dto.ts'), 'utf8')).not.toMatch(/profitEstimate\?:/);
});

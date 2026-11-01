/**
 * Drivers: CRUD, assignment to a vehicle, manual status, availability.
 * Everything is scoped to the caller's company; a driver or vehicle of
 * another company answers exactly like an unknown one (404).
 */
import { BadGatewayException, ConflictException, HttpStatus, Inject, Injectable, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { msg, type PlanMessageCode, type PlanMessageParams } from '../common/plan-messages';
import { isTowedCategory } from '../common/vehicle-category';
import { PrismaService } from '../prisma/prisma.service';
import { DRIVER_ACTIVITY_PROVIDER, DriverActivityProviderError, type DriverActivityProvider } from './activity/driver-activity-provider';
import type { AvailabilityQueryDto } from './dto/availability-query.dto';
import type { CreateDriverStatusDto } from './dto/create-driver-status.dto';
import type { CreateDriverDto } from './dto/create-driver.dto';
import type { UpdateDriverDto } from './dto/update-driver.dto';
import { driverAvailability } from './rules/availability';
import { DriverStatusError } from './rules/driver-state';

type ErrorClass = new (body: object) => Error;
function coded(Exception: ErrorClass, status: HttpStatus, code: PlanMessageCode, params?: PlanMessageParams): Error {
  const m = msg(code, params);
  return new Exception({ statusCode: status, ...m, message: m.code });
}

const VEHICLE_SUMMARY = { select: { id: true, plateNumber: true, vehicleCategory: true } } as const;
const STATUS_HISTORY_LIMIT = 50;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DRIVER_ACTIVITY_PROVIDER) private readonly activity: DriverActivityProvider,
  ) {}

  findAll(companyId: string, active?: boolean) {
    return this.prisma.driver.findMany({
      where: { companyId, ...(active === undefined ? {} : { active }) },
      include: { vehicle: VEHICLE_SUMMARY },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string, companyId: string) {
    const driver = await this.prisma.driver.findFirst({ where: { id, companyId }, include: { vehicle: VEHICLE_SUMMARY } });
    if (!driver) throw coded(NotFoundException, HttpStatus.NOT_FOUND, 'DRIVER_NOT_FOUND');
    return driver;
  }

  create(companyId: string, dto: CreateDriverDto) {
    return this.prisma.driver.create({ data: { ...dto, companyId }, include: { vehicle: VEHICLE_SUMMARY } });
  }

  async update(id: string, companyId: string, dto: UpdateDriverDto) {
    await this.findOne(id, companyId);
    return this.prisma.driver.update({ where: { id }, data: dto, include: { vehicle: VEHICLE_SUMMARY } });
  }

  /** Deletes the driver and the status history; the vehicle stays. */
  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    await this.prisma.driver.delete({ where: { id } });
    return { id, deleted: true };
  }

  async assignVehicle(id: string, companyId: string, vehicleId: string | null) {
    await this.findOne(id, companyId);
    if (vehicleId !== null) {
      const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId }, select: { id: true, vehicleCategory: true } });
      if (!vehicle) throw coded(NotFoundException, HttpStatus.NOT_FOUND, 'DRIVER_VEHICLE_NOT_FOUND');
      if (isTowedCategory(vehicle.vehicleCategory)) {
        throw coded(UnprocessableEntityException, HttpStatus.UNPROCESSABLE_ENTITY, 'DRIVER_VEHICLE_NOT_A_POWER_UNIT', { vehicleCategory: vehicle.vehicleCategory });
      }
      const holder = await this.prisma.driver.findFirst({ where: { vehicleId, NOT: { id } }, select: { id: true } });
      if (holder) throw coded(ConflictException, HttpStatus.CONFLICT, 'DRIVER_VEHICLE_ALREADY_ASSIGNED', { driverId: holder.id });
    }
    try {
      return await this.prisma.driver.update({ where: { id }, data: { vehicleId }, include: { vehicle: VEHICLE_SUMMARY } });
    } catch (e) {
      // Two assignments at once: the UNIQUE index decides.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw coded(ConflictException, HttpStatus.CONFLICT, 'DRIVER_VEHICLE_ALREADY_ASSIGNED', {});
      }
      throw e;
    }
  }

  async addStatus(id: string, companyId: string, userId: string, dto: CreateDriverStatusDto, now = new Date()) {
    await this.findOne(id, companyId);
    const invalid = statusProblem(dto);
    if (invalid) throw coded(BadRequestException, HttpStatus.BAD_REQUEST, 'DRIVER_STATUS_INVALID', { field: invalid });
    const date = (v?: string) => (v ? new Date(v) : null);
    return this.prisma.driverStatus.create({
      data: {
        driverId: id,
        enteredById: userId,
        asOf: date(dto.asOf) ?? now,
        weeklyRestEndedAt: new Date(dto.weeklyRestEndedAt),
        weeklyRestType: dto.weeklyRestType ?? null,
        weeklyRestAbroad: dto.weeklyRestAbroad ?? false,
        weeklyRestAtHome: dto.weeklyRestAtHome ?? false,
        recentWeeklyRests: dto.recentWeeklyRests
          ? dto.recentWeeklyRests.map((r) => ({ type: r.type, endedAt: new Date(r.endedAt).toISOString(), abroad: r.abroad }))
          : Prisma.DbNull,
        drivingThisWeekMinutes: dto.drivingThisWeekMinutes,
        drivingLastWeekMinutes: dto.drivingLastWeekMinutes,
        extendedDrivingDaysUsed: dto.extendedDrivingDaysUsed ?? null,
        reducedDailyRestsUsed: dto.reducedDailyRestsUsed ?? null,
        compensationOwedMinutes: dto.compensationOwedMinutes ?? null,
        compensationDueBy: date(dto.compensationDueBy),
        lastHomeRestEndedAt: date(dto.lastHomeRestEndedAt),
        driverChoseToStayAway: dto.driverChoseToStayAway ?? false,
        onDuty: dto.onDuty ?? null,
        dailyRestEndedAt: date(dto.dailyRestEndedAt),
        drivingSinceDailyRestMinutes: dto.drivingSinceDailyRestMinutes ?? null,
        drivingSinceBreakMinutes: dto.drivingSinceBreakMinutes ?? null,
        workSinceBreakMinutes: dto.workSinceBreakMinutes ?? null,
        unavailableUntil: date(dto.unavailableUntil),
        unavailableReason: dto.unavailableReason ?? null,
      },
    });
  }

  async statusHistory(id: string, companyId: string) {
    await this.findOne(id, companyId);
    const history = await this.prisma.driverStatus.findMany({ where: { driverId: id }, orderBy: { createdAt: 'desc' }, take: STATUS_HISTORY_LIMIT });
    return { current: history[0] ?? null, history };
  }

  async availability(id: string, companyId: string, query: AvailabilityQueryDto, now = new Date()) {
    await this.findOne(id, companyId);
    const at = query.at ? new Date(query.at) : now;
    // A status the engine cannot start from — from the provider (built with
    // statusFromHistory) or found by the engine — is 409 naming the field.
    // The provider failing for its source is 502 with its reason.
    try {
      const status = await this.activity.currentStatus(id);
      if (!status) throw coded(ConflictException, HttpStatus.CONFLICT, 'DRIVER_STATUS_MISSING');
      return { source: this.activity.source, ...driverAvailability(status, at, query.strategy ?? 'standard') };
    } catch (e) {
      if (e instanceof DriverStatusError) throw coded(ConflictException, HttpStatus.CONFLICT, 'DRIVER_STATUS_INCOMPLETE', { field: e.field });
      if (e instanceof DriverActivityProviderError) throw coded(BadGatewayException, HttpStatus.BAD_GATEWAY, 'DRIVER_ACTIVITY_PROVIDER_FAILED', { reason: e.reason });
      throw e;
    }
  }
}

/** Cross-field rules the DTO decorators cannot express; returns the offending field or null. */
export function statusProblem(dto: CreateDriverStatusDto): string | null {
  const t = (v?: string) => (v ? new Date(v).getTime() : null);
  if ((dto.compensationOwedMinutes ?? 0) > 0 && !dto.compensationDueBy) return 'compensationDueBy';
  if (dto.compensationOwedMinutes == null && dto.compensationDueBy) return 'compensationOwedMinutes';
  if (Boolean(dto.unavailableUntil) !== Boolean(dto.unavailableReason)) return dto.unavailableUntil ? 'unavailableReason' : 'unavailableUntil';
  const shift = [dto.drivingSinceDailyRestMinutes, dto.drivingSinceBreakMinutes, dto.workSinceBreakMinutes];
  // The duty block only with onDuty true, and always with it.
  if (dto.onDuty === true && !dto.dailyRestEndedAt) return 'dailyRestEndedAt';
  if (dto.onDuty !== true && (dto.dailyRestEndedAt || shift.some((v) => v != null))) return 'onDuty';
  if (dto.dailyRestEndedAt) {
    const missing = ['drivingSinceDailyRestMinutes', 'drivingSinceBreakMinutes', 'workSinceBreakMinutes'][shift.findIndex((v) => v == null)];
    if (missing) return missing;
    if (t(dto.dailyRestEndedAt)! < t(dto.weeklyRestEndedAt)!) return 'dailyRestEndedAt';
    if (dto.drivingSinceBreakMinutes! > dto.drivingSinceDailyRestMinutes!) return 'drivingSinceBreakMinutes';
  } else if (shift.some((v) => v != null)) {
    return 'dailyRestEndedAt';
  }
  const rests = dto.recentWeeklyRests;
  if (rests) {
    const first = rests[0];
    if (first.type !== dto.weeklyRestType || t(first.endedAt) !== t(dto.weeklyRestEndedAt) || first.abroad !== (dto.weeklyRestAbroad ?? false)) {
      return 'recentWeeklyRests';
    }
    for (let i = 1; i < rests.length; i++) if (t(rests[i].endedAt)! >= t(rests[i - 1].endedAt)!) return 'recentWeeklyRests';
  }
  return null;
}

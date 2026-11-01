/**
 * Default DriverActivityProvider: the status the dispatcher entered
 * (SPEC §6). It keeps no activity log, so `history` is always empty with
 * no coverage — never an invented "the driver rested".
 */
import { Injectable } from '@nestjs/common';
import type { DriverStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { DriverStatusSnapshot, WeeklyRestRecord } from '../rules/driver-state';
import type { DriverActivityHistory, DriverActivityProvider } from './driver-activity-provider';

@Injectable()
export class ManualDriverActivityProvider implements DriverActivityProvider {
  readonly source = 'manual';

  constructor(private readonly prisma: PrismaService) {}

  async history(): Promise<DriverActivityHistory> {
    return { source: this.source, activities: [], coveredFrom: null, coveredTo: null };
  }

  async currentStatus(driverId: string): Promise<DriverStatusSnapshot | null> {
    const row = await this.prisma.driverStatus.findFirst({ where: { driverId }, orderBy: { createdAt: 'desc' } });
    return row ? toSnapshot(row) : null;
  }
}

/** A DriverStatus row → the engine's snapshot. */
export function toSnapshot(row: DriverStatus): DriverStatusSnapshot {
  return {
    asOf: row.asOf,
    weeklyRestEndedAt: row.weeklyRestEndedAt,
    weeklyRestType: row.weeklyRestType,
    weeklyRestAbroad: row.weeklyRestAbroad,
    weeklyRestAtHome: row.weeklyRestAtHome,
    recentWeeklyRests: parseRecentWeeklyRests(row.recentWeeklyRests),
    drivingThisWeekMinutes: row.drivingThisWeekMinutes,
    drivingLastWeekMinutes: row.drivingLastWeekMinutes,
    extendedDrivingDaysUsed: row.extendedDrivingDaysUsed,
    reducedDailyRestsUsed: row.reducedDailyRestsUsed,
    compensationOwedMinutes: row.compensationOwedMinutes,
    compensationDueBy: row.compensationDueBy,
    lastHomeRestEndedAt: row.lastHomeRestEndedAt,
    driverChoseToStayAway: row.driverChoseToStayAway,
    onDuty: row.onDuty,
    dailyRestEndedAt: row.dailyRestEndedAt,
    drivingSinceDailyRestMinutes: row.drivingSinceDailyRestMinutes,
    drivingSinceBreakMinutes: row.drivingSinceBreakMinutes,
    workSinceBreakMinutes: row.workSinceBreakMinutes,
    unavailableUntil: row.unavailableUntil,
  };
}

/**
 * The JSON column was validated on write (DTO). Anything that does not
 * read back as the expected list is treated as unknown (null) — the
 * engine then does not apply the exception that needs it.
 */
export function parseRecentWeeklyRests(value: unknown): WeeklyRestRecord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return null;
  const out: WeeklyRestRecord[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') return null;
    const { type, endedAt, abroad } = v as Record<string, unknown>;
    const at = typeof endedAt === 'string' ? new Date(endedAt) : null;
    if ((type !== 'REGULAR' && type !== 'REDUCED') || !at || Number.isNaN(at.getTime()) || typeof abroad !== 'boolean') return null;
    out.push({ type, endedAt: at, abroad });
  }
  return out;
}

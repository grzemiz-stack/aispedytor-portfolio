import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, Max, Min, ValidateNested,
} from 'class-validator';

const REST_TYPES = ['REGULAR', 'REDUCED'] as const;
const UNAVAILABLE_REASONS = ['LEAVE', 'SICKNESS', 'DRIVER_REQUEST', 'OTHER'] as const;

export class WeeklyRestRecordDto {
  @ApiProperty({ enum: REST_TYPES })
  @IsIn(REST_TYPES)
  type!: (typeof REST_TYPES)[number];

  @ApiProperty({ example: '2026-10-05T06:00:00Z' })
  @IsISO8601({ strict: true })
  endedAt!: string;

  @ApiProperty({ description: 'Taken outside the Member State of establishment.' })
  @IsBoolean()
  abroad!: boolean;
}

/**
 * Manual driver status (SPEC §6). Instants are ISO 8601 (stored in UTC),
 * durations whole minutes. The bounds are physical, not legal: a status may
 * describe a driver who already broke a rule — the availability shows it.
 *
 * Required, no worst case (docs/decisions.md §11): the end of the last weekly
 * rest and the driving this week and last week — a missing one is 400 naming
 * the field. An omitted optional count is "don't know": the engine takes the
 * worst case and says so (DRIVER_STATE_ASSUMED).
 */
export class CreateDriverStatusDto {
  @ApiPropertyOptional({ description: 'The moment the counters describe. Default: now.', example: '2026-10-07T08:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;

  @ApiProperty({ description: 'End of the last weekly rest (may be in the future while it runs).', example: '2026-10-05T06:00:00Z' })
  @IsISO8601({ strict: true })
  weeklyRestEndedAt!: string;

  @ApiPropertyOptional({ enum: REST_TYPES, description: 'Omitted = unknown (taken as REDUCED).' })
  @IsOptional()
  @IsIn(REST_TYPES)
  weeklyRestType?: (typeof REST_TYPES)[number];

  @ApiPropertyOptional({ default: false, description: 'The last weekly rest was taken outside the Member State of establishment.' })
  @IsOptional()
  @IsBoolean()
  weeklyRestAbroad?: boolean;

  @ApiPropertyOptional({ default: false, description: 'The last weekly rest was taken at home or at the operational centre.' })
  @IsOptional()
  @IsBoolean()
  weeklyRestAtHome?: boolean;

  @ApiPropertyOptional({
    type: [WeeklyRestRecordDto],
    description: 'Up to three most recent weekly rests, newest first; the first is the rest above. Needed for the exception of two reduced weekly rests abroad (561/2006 art. 8(6)); without it the exception is not applied.',
  })
  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WeeklyRestRecordDto)
  recentWeeklyRests?: WeeklyRestRecordDto[];

  @ApiProperty({ description: 'Minutes of driving in the fixed week (Mon–Sun, UTC) of `asOf`.', minimum: 0, maximum: 10080 })
  @IsInt()
  @Min(0)
  @Max(10080)
  drivingThisWeekMinutes!: number;

  @ApiProperty({ description: 'Minutes of driving in the week before.', minimum: 0, maximum: 10080 })
  @IsInt()
  @Min(0)
  @Max(10080)
  drivingLastWeekMinutes!: number;

  @ApiPropertyOptional({ nullable: true, description: '10-hour driving days used in the week of `asOf`; omitted = unknown (taken as both used).', minimum: 0, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  extendedDrivingDaysUsed?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Reduced daily rests since the last weekly rest; omitted = unknown (taken as all three used).', minimum: 0, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  reducedDailyRestsUsed?: number;

  @ApiPropertyOptional({ description: 'Compensation owed for reduced weekly rests, minutes; 0 = nothing owed. Omitted = unknown (21 h for every reduced weekly rest of known date, by the earliest deadline).', minimum: 0, maximum: 2520 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2520)
  compensationOwedMinutes?: number;

  @ApiPropertyOptional({ description: 'Required when compensation is owed; only with `compensationOwedMinutes`.', example: '2026-10-26T00:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  compensationDueBy?: string;

  @ApiPropertyOptional({ description: 'End of the last regular weekly rest (or one over 45 h with compensation) at home or base. Omitted = unknown (the rest at home is taken as due at `asOf`).', example: '2026-10-05T06:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  lastHomeRestEndedAt?: string;

  @ApiPropertyOptional({ default: false, description: 'The company offered the return home; the driver chose to stay elsewhere.' })
  @IsOptional()
  @IsBoolean()
  driverChoseToStayAway?: boolean;

  @ApiPropertyOptional({ nullable: true, example: false, description: 'On duty at `asOf` (true — then `dailyRestEndedAt` and the three counters are required), resting (false), or omitted = unknown: taken as on duty with the day\'s driving, the break and work used up (DRIVER_STATE_ASSUMED).' })
  @IsOptional()
  @IsBoolean()
  onDuty?: boolean;

  @ApiPropertyOptional({ example: '2026-10-07T05:00:00Z', description: 'Only with `onDuty: true`: end of the last daily rest. Then the three counters below are required.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dailyRestEndedAt?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  drivingSinceDailyRestMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  drivingSinceBreakMinutes?: number;

  @ApiPropertyOptional({ description: 'Work (driving included) since the last break of at least 15 min.', minimum: 0, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  workSinceBreakMinutes?: number;

  @ApiPropertyOptional({ description: 'Leave, sickness…: the driver cannot start before this. Requires `unavailableReason`.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  unavailableUntil?: string;

  @ApiPropertyOptional({ enum: UNAVAILABLE_REASONS })
  @IsOptional()
  @IsIn(UNAVAILABLE_REASONS)
  unavailableReason?: (typeof UNAVAILABLE_REASONS)[number];
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ description: 'The moment asked about. Default: now.', example: '2026-10-07T08:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  at?: string;

  @ApiPropertyOptional({ enum: ['standard', 'earliest'], default: 'standard', description: 'earliest: also 10-hour days and reduced rests.' })
  @IsOptional()
  @IsIn(['standard', 'earliest'])
  strategy?: 'standard' | 'earliest';
}

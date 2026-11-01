import { IsIsoDateOrEmpty } from '../../common/dto/is-iso-date-or-empty.decorator';
import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsNumber, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateVehicleDto } from './create-vehicle.dto';
import { VehicleStatus } from '@prisma/client';

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  // No `currentLat` / `currentLng`: nothing reads them (matching, LTL, map) or
  // writes them — nobody updates the vehicle position (docs/known-issues.md).
  // The columns stay; where the position should come from is a product decision.

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  availableFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(16)
  freeMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(44000)
  freeWeightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentDirection?: string;
}

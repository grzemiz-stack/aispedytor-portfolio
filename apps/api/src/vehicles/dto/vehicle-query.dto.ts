import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { TOWED_CATEGORIES, VEHICLE_CATEGORIES, type TowedCategory, type VehicleCategory } from '../../common/vehicle-category';
import { VehicleStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class VehicleQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @ApiPropertyOptional({ enum: VEHICLE_CATEGORIES })
  @IsOptional()
  @IsIn(VEHICLE_CATEGORIES)
  vehicleCategory?: VehicleCategory;

  /**
   * Only vehicles that a record of this category may be attached to — the web
   * app filters its list with this rule instead of keeping its own copy.
   */
  @ApiPropertyOptional({ enum: TOWED_CATEGORIES })
  @IsOptional()
  @IsIn(TOWED_CATEGORIES)
  parentFor?: TowedCategory;
}

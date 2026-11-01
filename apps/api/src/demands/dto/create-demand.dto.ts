import { IsIsoDateOrEmpty } from '../../common/dto/is-iso-date-or-empty.decorator';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const VEHICLE_TYPES = ['CURTAINSIDER', 'REEFER', 'MEGA', 'BOX', 'TANKER', 'FLATBED', 'LOWLOADER', 'BUS', 'OTHER'];
const TRAILER_TYPES = ['STANDARD', 'MEGA', 'REEFER', 'CURTAINSIDER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export class CreateDemandDto {
  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Tytuł min. 2 znaki' })
  @MaxLength(200, { message: 'Tytuł max. 200 znaków' })
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: PRIORITIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  neededBy?: string;

  // Vehicle requirements
  @ApiPropertyOptional({ enum: VEHICLE_TYPES })
  @IsOptional()
  @IsIn(VEHICLE_TYPES, { message: 'Nieprawidłowy typ pojazdu' })
  vehicleType?: string;

  @ApiPropertyOptional({ enum: TRAILER_TYPES })
  @IsOptional()
  @IsIn(TRAILER_TYPES, { message: 'Nieprawidłowy typ naczepy' })
  trailerType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Min. 1 metr' })
  @Max(16, { message: 'Max. 16 metrów' })
  minLoadingMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1, { message: 'Min. 0.1 tony' })
  @Max(44, { message: 'Max. 44 tony' })
  maxWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  temperatureRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-30)
  @Max(30)
  temperatureMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-30)
  @Max(30)
  temperatureMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  adrRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adrClass?: string;

  // Route preferences
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ each: true })
  preferredCountries?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ each: true })
  regions?: string[];
}

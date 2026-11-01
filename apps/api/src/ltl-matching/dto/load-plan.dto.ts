import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoadItemDto {
  @ApiProperty({ description: 'Offer ID', example: 'offer-123' })
  @IsString()
  offerId: string;

  @ApiProperty({ description: 'Load weight in kg', example: 5000 })
  @IsNumber()
  @Min(0)
  @Max(30000, { message: 'Waga max. 30 000 kg' })
  weight: number;

  @ApiProperty({ description: 'Load length in meters', example: 3.2 })
  @IsNumber()
  @Min(0.1, { message: 'Długość min. 0.1 m' })
  @Max(13.6, { message: 'Długość max. 13.6 m' })
  meters: number;

  @ApiPropertyOptional({ description: 'Cargo description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Loading city', example: 'Poznań' })
  @IsString()
  loadingCity: string;

  @ApiProperty({ description: 'Unloading city', example: 'Hamburg' })
  @IsString()
  unloadingCity: string;

  @ApiPropertyOptional({ description: 'Position order index (1 = closest to doors)', example: 1 })
  @IsOptional()
  @IsNumber()
  position?: number;
}

export class CreateLoadPlanDto {
  @ApiProperty({ description: 'Vehicle UUID' })
  @IsString()
  vehicleId: string;

  @ApiProperty({ description: 'List of loads to plan', type: [LoadItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadItemDto)
  @ArrayMinSize(1, { message: 'Wymagany min. 1 ładunek' })
  loads: LoadItemDto[];
}

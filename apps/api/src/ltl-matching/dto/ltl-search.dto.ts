import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LtlSearchDto {
  @ApiProperty({ description: 'Vehicle UUID', example: 'abc-123' })
  @IsString()
  vehicleId: string;

  @ApiProperty({ description: 'Currently occupied loading meters', example: 5.0 })
  @IsNumber()
  @Min(0, { message: 'Zajęte metry nie mogą być ujemne' })
  @Max(16, { message: 'Zajęte metry max. 16 m' })
  currentLoadMeters: number;

  @ApiProperty({ description: 'Currently loaded weight in tonnes', example: 12.0 })
  @IsNumber()
  @Min(0, { message: 'Masa ładunku nie może być ujemna' })
  @Max(44, { message: 'Masa ładunku max. 44 t' })
  currentLoadWeight: number;

  @ApiProperty({ description: 'Route origin city', example: 'Poznań' })
  @IsString()
  @MinLength(2, { message: 'Miasto początkowe min. 2 znaki' })
  @MaxLength(100, { message: 'Miasto początkowe max. 100 znaków' })
  routeFrom: string;

  @ApiProperty({ description: 'Route destination city', example: 'Hamburg' })
  @IsString()
  @MinLength(2, { message: 'Miasto docelowe min. 2 znaki' })
  @MaxLength(100, { message: 'Miasto docelowe max. 100 znaków' })
  routeTo: string;

  /**
   * The only detour limit (km) — the one from the slider. There is no
   * percentage-of-route limit next to it.
   */
  @ApiPropertyOptional({ description: 'Max detour in km — the only detour limit', example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(10, { message: 'Max objazd min. 10 km' })
  @Max(500, { message: 'Max objazd max. 500 km' })
  maxDetourKm?: number;
}

import {
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsIn,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PointDto {
  @ApiProperty({ example: 52.2297 })
  @IsNumber()
  @Min(-90, { message: 'Szerokość geograficzna musi być między -90 a 90' })
  @Max(90, { message: 'Szerokość geograficzna musi być między -90 a 90' })
  lat: number;

  @ApiProperty({ example: 21.0122 })
  @IsNumber()
  @Min(-180, { message: 'Długość geograficzna musi być między -180 a 180' })
  @Max(180, { message: 'Długość geograficzna musi być między -180 a 180' })
  lng: number;

  @ApiPropertyOptional({ example: 'Warszawa, Polska' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class VehicleParamsDto {
  @ApiProperty({ description: 'Gross weight in kg', example: 40000 })
  @IsNumber()
  @Min(3500, { message: 'Masa całkowita min. 3 500 kg (3.5t)' })
  @Max(44000, { message: 'Masa całkowita max. 44 000 kg (44t)' })
  grossWeight: number;

  @ApiProperty({ description: 'Height in meters', example: 4.0 })
  @IsNumber()
  @Min(2.0, { message: 'Wysokość min. 2.0 m' })
  @Max(4.5, { message: 'Wysokość max. 4.5 m' })
  height: number;

  @ApiProperty({ description: 'Width in meters', example: 2.55 })
  @IsNumber()
  @Min(2.0, { message: 'Szerokość min. 2.0 m' })
  @Max(2.6, { message: 'Szerokość max. 2.6 m' })
  width: number;

  @ApiProperty({ description: 'Length in meters', example: 16.5 })
  @IsNumber()
  @Min(5, { message: 'Długość min. 5 m' })
  @Max(18.75, { message: 'Długość max. 18.75 m (zestaw)' })
  length: number;

  @ApiPropertyOptional({
    description:
      'Axles of the WHOLE combination (tractor + trailer). Omitted → 5+ is assumed ' +
      'and the saved route calculation is flagged axleClassDefaulted.',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(2, { message: 'Liczba osi min. 2' })
  @Max(7, { message: 'Liczba osi max. 7' })
  axleCount?: number;

  @ApiProperty({ description: 'Vehicle carries ADR goods', example: false })
  @IsBoolean()
  hasAdr: boolean;

  @ApiPropertyOptional({
    description: 'ADR class (1-9)',
    example: '3',
  })
  @IsOptional()
  @IsString()
  adrClass?: string;

  @ApiPropertyOptional({
    description: 'Euro emission class',
    example: 'Euro6',
    enum: ['Euro3', 'Euro4', 'Euro5', 'Euro6'],
  })
  @IsOptional()
  @IsIn(['Euro3', 'Euro4', 'Euro5', 'Euro6'])
  euroClass?: 'Euro3' | 'Euro4' | 'Euro5' | 'Euro6';
}

export class CalculateRouteDto {
  /**
   * The offer the route is calculated for. Optional — the planner also works
   * as a standalone tool, for addresses typed in by hand.
   *
   * When given, the result is saved in `route_calculations` (only with a
   * complete toll from the toll provider). Without this field the calculation
   * has nothing to attach the result to and is gone once the response is sent.
   */
  @ApiPropertyOptional({ description: 'Offer ID — the result is saved with this offer when the toll from the toll provider is complete' })
  @IsOptional()
  @IsString()
  offerId?: string;

  @ApiProperty({ type: PointDto })
  @ValidateNested()
  @Type(() => PointDto)
  origin: PointDto;

  @ApiProperty({ type: PointDto })
  @ValidateNested()
  @Type(() => PointDto)
  destination: PointDto;

  @ApiPropertyOptional({ type: [PointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  waypoints?: PointDto[];

  @ApiProperty({ type: VehicleParamsDto })
  @ValidateNested()
  @Type(() => VehicleParamsDto)
  vehicle: VehicleParamsDto;

  @ApiPropertyOptional({
    description: 'Freight rate (revenue)',
    example: 4500,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Stawka frachtu min. 1' })
  @Max(500000, { message: 'Stawka frachtu max. 500 000' })
  freightRate?: number;

  @ApiPropertyOptional({
    description: 'Currency for freight rate and results',
    example: 'PLN',
    enum: ['PLN', 'EUR'],
  })
  @IsOptional()
  @IsIn(['PLN', 'EUR'])
  currency?: 'PLN' | 'EUR';

  @ApiPropertyOptional({
    description: 'Max number of alternative routes (1-6). Currently has no effect: the OSRM adapter returns one route',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Min. 1 trasa' })
  @Max(6, { message: 'Max. 6 tras alternatywnych' })
  maxAlternatives?: number;
}

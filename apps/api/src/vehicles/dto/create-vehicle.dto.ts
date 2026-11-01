import { IsIsoDateOrEmpty } from '../../common/dto/is-iso-date-or-empty.decorator';
import {
  IsEnum,
  IsIn,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TrailerType, VehicleType } from '@prisma/client';
import { VEHICLE_CATEGORIES, type VehicleCategory } from '../../common/vehicle-category';

export class CreateVehicleDto {
  @ApiProperty({ example: 'WPO 4567A', description: 'Vehicle registration number' })
  @IsString()
  @MinLength(3, { message: 'Numer rejestracyjny min. 3 znaki' })
  @MaxLength(15, { message: 'Numer rejestracyjny max. 15 znaków' })
  @Matches(/^[A-Za-z0-9 -]{3,15}$/, {
    message: 'Numer rejestracyjny: litery, cyfry, spacje i myślniki (3-15 znaków)',
  })
  plateNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  licensePlate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  ocrNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1990)
  @Max(2030)
  year?: number;

  @ApiProperty({ enum: VehicleType, example: VehicleType.TRUCK })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ApiPropertyOptional({
    enum: VEHICLE_CATEGORIES,
    description: 'TRUCK = tractor unit, RIGID = rigid truck, SEMI_TRAILER = semi-trailer, TRAILER = drawbar trailer, VAN = van',
  })
  @IsOptional()
  @IsIn(VEHICLE_CATEGORIES, { message: `Kategoria: jedna z ${VEHICLE_CATEGORIES.join(', ')}` })
  vehicleCategory?: VehicleCategory;

  @ApiPropertyOptional({ enum: TrailerType })
  @IsOptional()
  @IsEnum(TrailerType)
  trailerType?: TrailerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parentVehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(500, { message: 'Masa max. min. 500 kg' })
  @Max(44000, { message: 'Masa max. nie może przekraczać 44 000 kg (44t)' })
  maxWeightKg?: number;

  @ApiPropertyOptional({ description: 'Gross vehicle weight of the combination in kg (maximum permitted total weight)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(500, { message: 'DMC min. 500 kg' })
  @Max(60000, { message: 'DMC nie może przekraczać 60 000 kg' })
  grossVehicleWeightKg?: number;

  @ApiPropertyOptional({ description: 'Curb (tare) weight of the combination in kg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Masa własna nie może być ujemna' })
  @Max(40000, { message: 'Masa własna nie może przekraczać 40 000 kg' })
  curbWeightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(200, { message: 'Objętość max. 200 m³' })
  maxVolumeM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Metry ładunkowe min. 1 m' })
  @Max(16, { message: 'Metry ładunkowe max. 16 m (mega trailer)' })
  maxLoadingMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Liczba palet min. 1' })
  @Max(40, { message: 'Liczba palet max. 40' })
  maxPalletCount?: number;

  @ApiPropertyOptional({
    description:
      'Axles of THIS record, not of the whole combination (a tractor usually 2, a semi-trailer usually 3). ' +
      'The toll axle class of the combination = the sum with the attached semi-trailers/trailers.',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2, { message: 'Liczba osi min. 2' })
  @Max(7, { message: 'Liczba osi max. 7' })
  axleCount?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the saved dimension (edit)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2, { message: 'Długość min. 2 m' })
  @Max(18.75, { message: 'Długość max. 18.75 m (zestaw)' })
  lengthM?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the saved dimension (edit)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2.0, { message: 'Wysokość min. 2.0 m' })
  @Max(4.5, { message: 'Wysokość max. 4.5 m' })
  heightM?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the saved dimension (edit)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2.0, { message: 'Szerokość min. 2.0 m' })
  @Max(2.6, { message: 'Szerokość max. 2.6 m (chłodnia)' })
  widthM?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasAdr?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasGps?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adrClasses?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currentCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  technicalInspectionFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  technicalInspectionTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  insuranceFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  insuranceTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  tachographLegalizationFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  tachographLegalizationTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  plannedMaintenanceDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  plannedMaintenanceNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fuelCardType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4)
  fuelCardLast4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIsoDateOrEmpty()
  fuelCardExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

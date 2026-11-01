import {
  IsEnum,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  MinLength,
  MaxLength,
  Length,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OfferSource } from '@prisma/client';

export class CreateOfferDto {
  @ApiPropertyOptional({ enum: OfferSource, example: OfferSource.MANUAL })
  @IsOptional()
  @IsEnum(OfferSource)
  source?: OfferSource;

  @ApiProperty({ example: 'Poznań', description: 'Pickup city' })
  @IsString()
  @MinLength(2, { message: 'Miasto załadunku musi mieć min. 2 znaki' })
  @MaxLength(100, { message: 'Miasto załadunku może mieć max. 100 znaków' })
  pickupCity: string;

  @ApiProperty({ example: 'PL', description: 'Pickup country (ISO 3166-1 alpha-2)' })
  @IsString()
  @Length(2, 2, { message: 'Kraj załadunku musi być kodem ISO (2 znaki, np. PL)' })
  pickupCountry: string;

  @ApiPropertyOptional({ example: '60-001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pickupPostal?: string;

  @ApiProperty({ example: '2026-03-20T08:00:00Z', description: 'Pickup date (ISO 8601)' })
  @IsDateString()
  pickupDate: string;

  @ApiProperty({ example: 'Hamburg', description: 'Delivery city' })
  @IsString()
  @MinLength(2, { message: 'Miasto rozładunku musi mieć min. 2 znaki' })
  @MaxLength(100, { message: 'Miasto rozładunku może mieć max. 100 znaków' })
  deliveryCity: string;

  @ApiProperty({ example: 'DE', description: 'Delivery country (ISO 3166-1 alpha-2)' })
  @IsString()
  @Length(2, 2, { message: 'Kraj rozładunku musi być kodem ISO (2 znaki, np. DE)' })
  deliveryCountry: string;

  @ApiPropertyOptional({ example: '20095' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  deliveryPostal?: string;

  @ApiPropertyOptional({ example: '2026-03-21T16:00:00Z' })
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({ example: 'EURO pallets' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cargoType?: string;

  @ApiPropertyOptional({ example: 18500, description: 'Cargo weight in kg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1, { message: 'Waga musi wynosić min. 0.1 kg' })
  @Max(44000, { message: 'Waga nie może przekraczać 44 000 kg (44t)' })
  weightKg?: number;

  @ApiPropertyOptional({ example: 85.5, description: 'Cargo volume in m³' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(200, { message: 'Objętość nie może przekraczać 200 m³' })
  volumeM3?: number;

  @ApiPropertyOptional({ example: 13.6, description: 'Cargo length in metres' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(18.75, { message: 'Długość nie może przekraczać 18.75 m' })
  lengthM?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isAdr?: boolean;

  @ApiPropertyOptional({ example: '3', description: 'ADR class (1-9)' })
  @IsOptional()
  @IsString()
  adrClass?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFrigo?: boolean;

  @ApiPropertyOptional({ example: -18, description: 'Minimum temperature (°C)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40, { message: 'Temperatura min. nie może być niższa niż -40°C' })
  @Max(30)
  temperatureMin?: number;

  @ApiPropertyOptional({ example: -15, description: 'Maximum temperature (°C)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(30, { message: 'Temperatura max. nie może przekraczać 30°C' })
  temperatureMax?: number;

  @ApiPropertyOptional({ example: 4200, description: 'Freight price, in `currency`' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Cena musi wynosić min. 1' })
  @Max(500000, { message: 'Cena nie może przekraczać 500 000' })
  price?: number;

  @ApiPropertyOptional({ example: 'EUR', description: 'Currency code; any string is accepted, EUR when omitted' })
  @IsOptional()
  @IsString()
  currency?: string;

  // The rate per km, the total cost, the profit and the margin are NOT request
  // fields: the API computes the rate per km from the price and the distance,
  // and no margin is computed on save. An old client sending them gets a 400
  // (a field outside the schema).
  @ApiPropertyOptional({ example: 620, description: 'Distance in km' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Dystans musi wynosić min. 1 km' })
  @Max(10000, { message: 'Dystans nie może przekraczać 10 000 km' })
  distanceKm?: number;

  @ApiPropertyOptional({ example: 850 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  fuelCostEstimate?: number;

  @ApiPropertyOptional({ example: 320 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(50000)
  tollCostEstimate?: number;

  @ApiPropertyOptional({ example: 'Side unloading, ramp 1.2 m' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 'Trans-Logistic Sp. z o.o.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractorId?: string;

  @ApiPropertyOptional({ example: 'biuro@trans-logistic.example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+48 601 234 567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'TEU-2026-00142' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ example: '2026-03-19T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'Penalty of 500 EUR for a delay over 2 h' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  penaltyClauses?: string;

  @ApiPropertyOptional({ example: 120, description: 'Loading time window in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1440, { message: 'Okienko załadunku max. 1440 min (24h)' })
  loadingTimeWindow?: number;

  @ApiPropertyOptional({ example: 90, description: 'Unloading time window in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1440, { message: 'Okienko rozładunku max. 1440 min (24h)' })
  unloadingTimeWindow?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  palletExchange?: boolean;

  @ApiPropertyOptional({ example: 'EURO' })
  @IsOptional()
  @IsString()
  palletExchangeType?: string;

  @ApiPropertyOptional({ example: 33 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(40, { message: 'Liczba palet nie może przekraczać 40' })
  palletCount?: number;

  @ApiPropertyOptional({ example: 300000, description: 'Minimum carrier liability insurance (OCP) required, in EUR' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5000000)
  requiredInsuranceMin?: number;

  @ApiPropertyOptional({ example: 45, description: 'Payment term in days' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(180, { message: 'Termin płatności max. 180 dni' })
  paymentTermDays?: number;

  @ApiPropertyOptional({ example: 'Unloading lane of at least 3 m required' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialRequirements?: string;
}

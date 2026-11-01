import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RawOffer } from '../raw-offer';

/**
 * One imported offer — the same fields as `RawOffer` (raw-offer.ts), validated.
 * Numbers may arrive as strings (`"24000"`), as `normalizeRawOffer` accepted
 * them, so `@Type(() => Number)` converts them; a string that is not a number
 * gives 400.
 */
export class RawOfferDto implements RawOffer {
  @ApiPropertyOptional() @IsOptional() @IsString() externalId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() pickupCity: string;
  @ApiProperty() @IsString() @IsNotEmpty() pickupCountry: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pickupPostal?: string;
  @ApiProperty() @IsString() @IsNotEmpty() deliveryCity: string;
  @ApiProperty() @IsString() @IsNotEmpty() deliveryCountry: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryPostal?: string;
  @ApiProperty({ description: 'YYYY-MM-DD, DD.MM.YYYY or DD/MM/YYYY' }) @IsString() @IsNotEmpty() pickupDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cargoType?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() volumeM3?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() distanceKm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pricePerKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAdr?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFrigo?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() temperatureMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() temperatureMax?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clientName?: string;
}

/**
 * Offer import (POST /offers/import). Only the request structure is checked
 * here (the source, `offers` as a list; fields outside the schema → 400). The
 * service checks every row on its own (`import-row.ts`): a bad row goes to
 * `rejected` as {row, field, code}, the rest is saved. The row rules —
 * `RawOfferDto` above.
 */
export class ImportOffersDto {
  @ApiProperty({ description: 'Source: manual, api, email, generic (anything else → generic)' })
  @IsString()
  @IsNotEmpty()
  source: string;

  @ApiPropertyOptional({ type: [RawOfferDto], description: 'Rows checked one by one; a bad row → rejected, not 400' })
  @IsOptional()
  @IsArray()
  offers?: unknown[];
}

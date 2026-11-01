import { IsString, IsOptional, IsInt, IsBoolean, Min, Max, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateContractorDto {
  @ApiProperty()
  @IsString()
  @MinLength(2, { message: 'Nazwa musi mieć min. 2 znaki' })
  @MaxLength(200, { message: 'Nazwa może mieć max. 200 znaków' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'NIP/Tax ID musi mieć min. 5 znaków' })
  @MaxLength(20, { message: 'NIP/Tax ID może mieć max. 20 znaków' })
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Wartość musi być liczbą całkowitą' }) // the rating and day columns are Int in the database
  @Min(1, { message: 'Ocena musi wynosić min. 1' })
  @Max(5, { message: 'Ocena może wynosić max. 5' })
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Wartość musi być liczbą całkowitą' })
  @Min(1, { message: 'Rating płatności musi wynosić min. 1' })
  @Max(5, { message: 'Rating płatności może wynosić max. 5' })
  paymentRating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Wartość musi być liczbą całkowitą' })
  @Min(0, { message: 'Wynik niezawodności musi wynosić min. 0' })
  @Max(100, { message: 'Wynik niezawodności może wynosić max. 100' })
  reliabilityScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Wartość musi być liczbą całkowitą' })
  @Min(0)
  @Max(365, { message: 'Średni czas płatności max. 365 dni' })
  avgPaymentDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** The company blacklist — only an ADMIN changes it (another role → 403 CONTRACTOR_BLACKLIST_ADMIN_ONLY; decisions §3b). */
  @ApiPropertyOptional({ description: 'The company blacklist — only an ADMIN changes it (403 CONTRACTOR_BLACKLIST_ADMIN_ONLY)' })
  @IsOptional()
  @IsBoolean()
  isBlacklisted?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDriverDto {
  @ApiProperty({ example: 'Jan', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Kowalski', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+48 600 000 000', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'jan.kowalski@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Poznań', description: 'Where the driver lives (for the return home).', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  homeCity?: string;

  @ApiPropertyOptional({ example: 'PL', description: 'ISO 3166-1 alpha-2.' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  homeCountry?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

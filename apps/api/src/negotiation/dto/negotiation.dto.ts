import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PriceSimulationDto {
  @ApiProperty()
  @IsString()
  offerId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1, { message: 'Proponowana cena min. 1' })
  @Max(500000, { message: 'Proponowana cena max. 500 000' })
  proposedPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;
}

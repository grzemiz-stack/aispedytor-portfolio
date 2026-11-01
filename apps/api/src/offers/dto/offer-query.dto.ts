import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OfferSource, OfferStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class OfferQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OfferStatus })
  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ enum: OfferSource })
  @IsOptional()
  @IsEnum(OfferSource)
  source?: OfferSource;
}

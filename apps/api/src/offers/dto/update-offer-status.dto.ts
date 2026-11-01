import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OfferStatus } from '@prisma/client';

/**
 * Body of PATCH /api/offers/:id/status.
 *
 * A class, not an interface: the global ValidationPipe validates classes only.
 * With an interface any string reached Prisma and failed with a
 * PrismaClientValidationError (500); @IsEnum turns it into a 400 that lists
 * the allowed values.
 */
export class UpdateOfferStatusDto {
  @ApiProperty({ enum: OfferStatus })
  @IsEnum(OfferStatus)
  status: OfferStatus;
}

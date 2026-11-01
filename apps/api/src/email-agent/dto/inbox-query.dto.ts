import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmailCategory } from '@prisma/client';

const EMAIL_CATEGORIES = Object.values(EmailCategory);

/**
 * E-mail list filters (GET /email-agent/inbox). Values stay strings — the
 * service compares and parses them itself.
 */
export class InboxQueryDto {
  // Only EmailCategory values or ALL — any other value went to Prisma and
  // ended in a 500 (an invalid enum value).
  @ApiPropertyOptional({ enum: [...EMAIL_CATEGORIES, 'ALL'], description: 'A category or ALL' })
  @IsOptional()
  @IsIn([...EMAIL_CATEGORIES, 'ALL'])
  category?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  starred?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Items per page (up to 100)' })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'limit musi być liczbą całkowitą' })
  limit?: string;

  @ApiPropertyOptional({ description: 'Page number from 1 (as in the other lists)' })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'page musi być liczbą całkowitą' })
  page?: string;

  /** Deprecated: the page number under its old name. With `page` and `offset` at once, `page` wins. */
  @ApiPropertyOptional({ description: 'Deprecated — page number from 1 (the old name of `page`); with both, `page` wins', deprecated: true })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'offset musi być liczbą całkowitą' })
  offset?: string;
}

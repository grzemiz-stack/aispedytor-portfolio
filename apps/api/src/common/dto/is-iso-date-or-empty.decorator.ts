import { applyDecorators } from '@nestjs/common';
import { IsISO8601, ValidateIf } from 'class-validator';

/**
 * An ISO 8601 date (`2026-10-10` or with a time), checked strictly — "jutro",
 * `2026-13-45` or `32.10.2026` give 400 naming the field (before: `@IsString`
 * → `Invalid Date` → 500). An empty string passes: the vehicle form sends
 * `''` to clear a date, and the service turns it into `null`. A missing field
 * is handled by `@IsOptional()` next to it.
 */
export const IsIsoDateOrEmpty = () => applyDecorators(ValidateIf((_o, v) => v !== ''), IsISO8601({ strict: true }));

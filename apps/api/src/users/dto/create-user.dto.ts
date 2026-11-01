import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Roles an ADMIN can assign — the `UserRole` enum in the schema. */
export const USER_ROLES = ['ADMIN', 'DISPATCHER'] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

/**
 * New user of the caller's company (POST /users, ADMIN only).
 *
 * Must stay a class, not an interface: at runtime an interface is `Object`,
 * so `ValidationPipe` would have nothing to check and would let through an
 * empty e-mail, a password "1", a role outside the enum (a 500 from the
 * database) and any extra fields. Rules as at company registration.
 */
export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ enum: USER_ROLES, default: 'DISPATCHER' })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRoleName;
}

import { IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

/**
 * An e-mail to classify and save (POST /email-agent/process). A validated
 * class: a missing `subject`/`body` or a field outside the schema is 400.
 */
export class ProcessEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromName?: string;

  @ApiProperty()
  @IsEmail()
  fromEmail: string;

  @ApiProperty()
  @IsEmail()
  toEmail: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'ISO date; without it — now' })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageId?: string;
}

/** Classification simulation (POST /email-agent/simulate) — no recipient, nothing is saved. */
export class SimulateEmailDto extends OmitType(ProcessEmailDto, ['toEmail'] as const) {}

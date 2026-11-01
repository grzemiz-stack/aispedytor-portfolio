import { IsEmail, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { COMPANY_CURRENCIES, type CompanyCurrency } from '../../common/company-currency';

/**
 * Company fields that the company's own administrator may change.
 *
 * An allow-list, not a deny-list: a new field in `Company` does not become
 * editable by accident. Billing fields and limits (`subscriptionPlan`,
 * `maxDispatchers`) and `settings` are left out on purpose — the system sets
 * them, not the customer.
 *
 * The global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) rejects
 * any field not declared in this class with a 400. That works only because
 * the controller takes THIS class as the body type — with `dto: any` there
 * would be nothing to check.
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Trans-Pol Sp. z o.o.' })
  // The name is required in the database — it may be changed, not cleared.
  @ValidateIf(o => o.name !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'Nazwa firmy nie może być pusta' })
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: '7792345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  regon?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @ApiPropertyOptional({ example: 'PL', description: 'ISO 3166-1 alpha-2 country code, upper case' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Kraj: dwuliterowy kod ISO, wielkimi literami (np. PL, GB)' })
  country?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Nieprawidłowy adres e-mail do faktur' })
  @MaxLength(200)
  billingEmail?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string | null;

  @ApiPropertyOptional({ example: 4.2, description: 'Cost per km in costCurrency; null = not given (the LTL ranking then uses revenue instead of profit)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'Koszt kilometra: liczba, najwyżej 2 miejsca po przecinku' })
  @IsPositive({ message: 'Koszt kilometra musi być większy od zera' })
  // The limit of the DECIMAL(10,2) column — above it the database would fail with a 500.
  @Max(99_999_999.99)
  costPerKm?: number | null;

  @ApiPropertyOptional({ enum: COMPANY_CURRENCIES, example: 'PLN' })
  // NOT NULL column — the currency may be changed, not cleared.
  @ValidateIf(o => o.costCurrency !== undefined)
  @IsIn(COMPANY_CURRENCIES, { message: `Waluta firmy: ${COMPANY_CURRENCIES.join(', ')}` })
  costCurrency?: CompanyCurrency;
}

/** The allow-listed keys — the service writes only these, also when called by something other than the controller. */
export const UPDATABLE_COMPANY_FIELDS = [
  'name',
  'taxId',
  'regon',
  'street',
  'city',
  'postalCode',
  'country',
  'billingEmail',
  'phone',
  'website',
  'costPerKm',
  'costCurrency',
] as const satisfies readonly (keyof UpdateCompanyDto)[];

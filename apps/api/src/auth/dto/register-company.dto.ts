import { IsString, IsEmail, IsOptional, MinLength, MaxLength, IsNotEmpty } from 'class-validator';

export class RegisterCompanyDto {
  // Company
  @IsString() @IsNotEmpty() companyName: string;
  @IsString() @IsNotEmpty() taxId: string;
  @IsOptional() @IsString() regon?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsEmail() billingEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;

  // The company's first user (ADMIN)
  @IsEmail() email: string;
  @IsString() @MinLength(2) firstName: string;
  @IsString() @MinLength(2) lastName: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
}

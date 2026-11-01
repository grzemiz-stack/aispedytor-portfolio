import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@spedytor.example.com', description: "User's e-mail address" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'admin123', description: 'Password (at least 6 characters)', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegistrationEnabledGuard } from '../common/config/registration';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('auth')
@Throttle({ default: { ttl: 60000, limit: 5 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in — returns an access token (JWT), a refresh token and the user' })
  @ApiResponse({ status: 200, description: '{ accessToken, refreshToken, user }' })
  @ApiResponse({ status: 401, description: 'Wrong e-mail or password, or an inactive account' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (the used refresh token is deleted)' })
  @ApiResponse({ status: 200, description: '{ accessToken, refreshToken } — a new pair' })
  @ApiResponse({ status: 401, description: 'Not returned for a bad token: an unknown or expired refresh token gets 403' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out — deletes all refresh tokens of the user (every session); issued access tokens stay valid until they expire' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  logout(@Req() req: AuthenticatedRequest) {
    return this.authService.logout(req.user.userId);
  }


  @Post('register')
  @UseGuards(RegistrationEnabledGuard)
  @ApiOperation({ summary: 'Register a new company and its first ADMIN user (no plan or trial is set up)' })
  @ApiResponse({ status: 201, description: 'Company registered: { accessToken, refreshToken, userId, companyId }' })
  @ApiResponse({ status: 400, description: 'Validation error, or REGISTER_TAX_ID_INVALID (tax ID of a company in PL: 10 digits with the check digit)' })
  @ApiResponse({ status: 409, description: 'REGISTER_EMAIL_TAKEN — an account with this e-mail address already exists' })
  @ApiResponse({ status: 403, description: 'REGISTRATION_DISABLED — registration is off (an explicit NODE_ENV=development|test or REGISTRATION_ENABLED=true turns it on); the first company: npm run company:create' })
  register(@Body() dto: RegisterCompanyDto) {
    return this.authService.registerCompany(dto);
  }

}
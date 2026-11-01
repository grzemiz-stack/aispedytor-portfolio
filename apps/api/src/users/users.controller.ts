import { Controller, Get, Post, Patch, Body, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AuthService } from '../auth/auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List the active users of the company (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Array of users' })
  @ApiResponse({ status: 403, description: 'Forbidden — the caller is not an ADMIN' })
  findAll(@Req() req: AuthenticatedRequest) {
    return this.usersService.findAll(req.user.companyId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Profile of the logged-in user' })
  @ApiResponse({ status: 200, description: 'User object' })
  getMe(@Req() req: AuthenticatedRequest) {
    return this.usersService.findOne(req.user.userId, req.user.companyId);
  }

  @Patch('me/password')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Change own password — revokes all refresh tokens of the user, returns a new token pair' })
  @ApiResponse({ status: 200, description: '{ accessToken, refreshToken } for the current session' })
  @ApiResponse({ status: 400, description: 'PASSWORD_CURRENT_INVALID, PASSWORD_UNCHANGED or a validation error' })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthenticatedRequest) {
    return this.authService.changePassword(req.user.userId, req.user.companyId, dto);
  }

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'User details, also of a deactivated user (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'User object' })
  @ApiResponse({ status: 404, description: 'User not found in this company' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.findOne(id, req.user.companyId);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add a user to the company (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Created user' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Forbidden — the caller is not an ADMIN' })
  create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    return this.usersService.create(req.user.companyId, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Deactivate a user — sets isActive to false and deletes their refresh tokens; the record stays (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'The deactivated user (decrypted, no hashes)' })
  @ApiResponse({ status: 404, description: 'User not found in this company' })
  @ApiResponse({ status: 409, description: 'LAST_ACTIVE_ADMIN — the last active ADMIN of the company cannot be deactivated; CONCURRENT_CHANGE_RETRY — a concurrent change, retry the request' })
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.deactivate(id, req.user.companyId);
  }
}

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiParam, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoutePlannerService } from './route-planner.service';
import { CalculateRouteDto } from './dto/calculate-route.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('route-planner')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Controller('route-planner')
export class RoutePlannerController {
  constructor(private readonly routePlannerService: RoutePlannerService) {}

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate a route: distance, duration, fuel cost, toll from the toll provider, margin; saved with the offer when offerId is given' })
  @ApiResponse({ status: 200, description: 'Route alternatives with costs, a recommendation and the restrictions of the countries on the route' })
  @ApiResponse({ status: 400, description: 'Validation error (e.g. a missing point)' })
  calculate(@Body() dto: CalculateRouteDto, @Req() req: AuthenticatedRequest) {
    // `companyId` comes from the token, not from the request body — saving the result
    // must check who owns the offer, and the browser is not the source of truth here.
    return this.routePlannerService.calculateRoute(dto, req.user.companyId);
  }

  @Get('restrictions/:country')
  @ApiOperation({ summary: 'Road rules for one country (weekend bans, low-emission zones, a description of the toll system — no amounts)' })
  @ApiResponse({ status: 200, description: 'Restrictions of the given country' })
  @ApiParam({ name: 'country', example: 'DE', description: 'ISO 3166-1 alpha-2 country code' })
  getRestrictions(@Param('country') country: string) {
    return this.routePlannerService.getCountryRestrictions(country);
  }

  @Get('restrictions')
  @ApiOperation({ summary: 'Road rules for all countries in the table (20 countries, including CH)' })
  @ApiResponse({ status: 200, description: 'Array of country restrictions' })
  getAllRestrictions() {
    return this.routePlannerService.getAllCountryRestrictions();
  }
}

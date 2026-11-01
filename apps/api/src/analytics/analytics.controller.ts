import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('route-stats')
  @ApiOperation({ summary: 'Price statistics for one route, from the company offers that have a price per km: average/min/max per km, average price, offer count, last offer date, 30-day trend' })
  @ApiResponse({ status: 200, description: 'Statistics for the route; amounts in the company currency (`money` lists conversions and unconverted offers)' })
  @ApiQuery({ name: 'pickupCountry', required: true, example: 'PL' })
  @ApiQuery({ name: 'deliveryCountry', required: true, example: 'DE' })
  @ApiQuery({ name: 'pickupPostal', required: false })
  @ApiQuery({ name: 'deliveryPostal', required: false })
  getRouteStats(
    @Req() req: AuthenticatedRequest,
    @Query('pickupCountry') pickupCountry: string,
    @Query('deliveryCountry') deliveryCountry: string,
    @Query('pickupPostal') pickupPostal?: string,
    @Query('deliveryPostal') deliveryPostal?: string,
  ) {
    return this.analyticsService.getRouteStats(
      req.user.companyId,
      pickupCountry,
      deliveryCountry,
      pickupPostal,
      deliveryPostal,
    );
  }

  @Get('market-overview')
  @ApiOperation({ summary: 'Overview of the company offers: top 5 routes by offer count with average price per km, average margin, revenue of accepted offers, offers this and last month, last 6 months' })
  @ApiResponse({ status: 200, description: 'Overview; amounts in the company currency (`money` lists conversions and unconverted offers)' })
  getMarketOverview(@Req() req: AuthenticatedRequest) {
    return this.analyticsService.getMarketOverview(req.user.companyId);
  }
}

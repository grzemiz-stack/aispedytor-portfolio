import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LtlMatchingService } from './ltl-matching.service';
import { LtlSearchDto } from './dto/ltl-search.dto';
import { CreateLoadPlanDto } from './dto/load-plan.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('ltl')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ltl')
export class LtlMatchingController {
  constructor(private readonly ltlService: LtlMatchingService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Find part-load (LTL) offers that fit the vehicle on its route',
    description:
      'An offer without a weight or dimensions is NOT checked against capacity — missing ' +
      'data does not pass as zero. Such offers are listed in `unmeasurable` with what they ' +
      'lack, instead of appearing among the matches.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Vehicle capacity, ranked matches, and `unmeasurable` — offers left out of the ' +
      'calculation for a missing weight or dimensions.',
    schema: {
      type: 'object',
      properties: {
        capacity: { type: 'object' },
        matches: { type: 'array', items: { type: 'object' } },
        unmeasurable: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offerId: { type: 'string' },
              pickupCity: { type: 'string' },
              pickupCountry: { type: 'string' },
              deliveryCity: { type: 'string' },
              deliveryCountry: { type: 'string' },
              pickupDate: { type: 'string', format: 'date-time' },
              missing: {
                type: 'array',
                items: { type: 'string', enum: ['weightKg', 'dimensions'] },
              },
            },
          },
          description: 'At most 20, the nearest loading first.',
        },
        unmeasurableTotal: { type: 'number', description: 'Every offer without weight or dimensions.' },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'The vehicle record is incomplete (capacity, loading metres, gross vehicle weight or ' +
      'curb weight missing) — capacity cannot be computed. The response has ' +
      '`error: "IncompleteVehicleRecord"`, `vehicleId`, `plateNumber` and `missing` with the field names.',
  })
  search(@Body() dto: LtlSearchDto, @Req() req: AuthenticatedRequest) {
    return this.ltlService.findMatchingOffers(req.user.companyId, dto);
  }

  @Get('capacity/:vehicleId')
  @ApiOperation({ summary: 'Free cargo space of a vehicle' })
  @ApiResponse({ status: 200, description: 'Free space (metres, kg, %)' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @ApiQuery({ name: 'loadMeters', required: false, description: 'Loading metres already taken' })
  @ApiQuery({ name: 'loadWeight', required: false, description: 'Weight already loaded (t)' })
  @ApiResponse({
    status: 422,
    description:
      'The vehicle record is incomplete (capacity, loading metres, gross vehicle weight or ' +
      'curb weight missing) — capacity cannot be computed. The response has ' +
      '`error: "IncompleteVehicleRecord"`, `vehicleId`, `plateNumber` and `missing` with the field names.',
  })
  getCapacity(
    @Param('vehicleId') vehicleId: string,
    @Query('loadMeters') loadMeters?: string,
    @Query('loadWeight') loadWeight?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.ltlService.getVehicleCapacity(
      vehicleId,
      req.user.companyId,
      parseFloat(loadMeters || '0'),
      parseFloat(loadWeight || '0') * 1000,
    );
  }

  @Post('load-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Load plan for the selected offers on a vehicle (nothing is saved)' })
  @ApiResponse({ status: 200, description: 'Load plan: positions, cumulative weight and metres, warnings' })
  @ApiResponse({ status: 400, description: 'Invalid request body (validation). Exceeded length, capacity or GVW is not an error: it comes back as warnings with `isValid: false`.' })
  @ApiResponse({
    status: 422,
    description:
      'The vehicle record is incomplete (capacity, loading metres, gross vehicle weight or ' +
      'curb weight missing) — capacity cannot be computed. The response has ' +
      '`error: "IncompleteVehicleRecord"`, `vehicleId`, `plateNumber` and `missing` with the field names.',
  })
  createLoadPlan(@Body() dto: CreateLoadPlanDto, @Req() req: AuthenticatedRequest) {
    return this.ltlService.calculateLoadPlan(req.user.companyId, dto);
  }

  @Post('load-plan/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Load plan simulation — the same as POST /ltl/load-plan (nothing is saved)' })
  @ApiResponse({ status: 200, description: 'Load plan' })
  @ApiResponse({
    status: 422,
    description:
      'The vehicle record is incomplete (capacity, loading metres, gross vehicle weight or ' +
      'curb weight missing) — capacity cannot be computed. The response has ' +
      '`error: "IncompleteVehicleRecord"`, `vehicleId`, `plateNumber` and `missing` with the field names.',
  })
  simulateLoadPlan(@Body() dto: CreateLoadPlanDto, @Req() req: AuthenticatedRequest) {
    return this.ltlService.calculateLoadPlan(req.user.companyId, dto);
  }

  @Post('load-plan/optimize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder the loads by weight — heaviest towards the middle of the cargo space; no axle-load calculation' })
  @ApiResponse({ status: 200, description: 'Load plan with the loads reordered' })
  @ApiResponse({
    status: 422,
    description:
      'The vehicle record is incomplete (capacity, loading metres, gross vehicle weight or ' +
      'curb weight missing) — capacity cannot be computed. The response has ' +
      '`error: "IncompleteVehicleRecord"`, `vehicleId`, `plateNumber` and `missing` with the field names.',
  })
  optimizeLoadPlan(@Body() dto: CreateLoadPlanDto, @Req() req: AuthenticatedRequest) {
    return this.ltlService.optimizeLoadPlan(req.user.companyId, dto);
  }
}

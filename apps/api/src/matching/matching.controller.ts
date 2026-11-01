import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('matching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('vehicle-for-offer/:offerId')
  @ApiOperation({
    summary: 'Vehicles for an offer, scored 0–100 (type/reefer, availability, payload, country, documents)',
    description: 'All vehicles of the company, highest score first. ADR is checked with the shared rule (common/adr.ts): a vehicle that may not carry the load stays in the list with score 0 and the reason in `blockedBy`.',
  })
  @ApiResponse({ status: 200, description: 'Vehicles with their score, highest first' })
  @ApiResponse({ status: 404, description: 'Offer not found (or it belongs to another company)' })
  vehicleForOffer(@Param('offerId') offerId: string, @Req() req: AuthenticatedRequest) {
    return this.matchingService.findMatchingVehicles(offerId, req.user.companyId);
  }

  @Get('offers-for-vehicle/:vehicleId')
  @ApiOperation({
    summary: 'Offers for a vehicle, scored as above',
    description: 'The 50 newest offers with status NEW or ASSIGNED, highest score first. An ADR offer the vehicle may not carry: score 0 and the reason in `blockedBy`.',
  })
  @ApiResponse({ status: 200, description: 'Offers with their score, highest first' })
  @ApiResponse({ status: 404, description: 'Vehicle not found (or it belongs to another company)' })
  offersForVehicle(@Param('vehicleId') vehicleId: string, @Req() req: AuthenticatedRequest) {
    return this.matchingService.findMatchingOffers(vehicleId, req.user.companyId);
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Vehicle↔offer suggestions for the fleet — only ADR-compatible vehicles' })
  @ApiResponse({ status: 200, description: 'Up to 10 offer–vehicle pairs: for each of the 20 newest NEW or ASSIGNED offers, its best-scored vehicle if the score is at least 30' })
  suggestions(@Req() req: AuthenticatedRequest) {
    return this.matchingService.getSuggestions(req.user.companyId);
  }
}

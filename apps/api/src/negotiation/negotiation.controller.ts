import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NegotiationService } from './negotiation.service';
import { PriceSimulationDto } from './dto/negotiation.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('negotiation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Controller('negotiation')
export class NegotiationController {
  constructor(private readonly negotiationService: NegotiationService) {}

  @Post('analyze/:offerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Negotiation analysis of an offer: price range from the company history, market position, contractor profile, arguments and price scenarios' })
  @ApiResponse({ status: 200, description: 'Analysis result; simulation.available is false when the toll or the exchange rate is unknown' })
  @ApiResponse({ status: 404, description: 'Offer not found in the caller company' })
  analyze(@Param('offerId') offerId: string, @Req() req: AuthenticatedRequest) {
    return this.negotiationService.analyzeOffer(offerId, req.user.companyId);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Negotiation simulation: margin in PLN for fixed price scenarios and for the proposed price' })
  @ApiResponse({ status: 200, description: 'Scenarios with margin, break-even price and the 12-20% margin range; available is false when the toll or the exchange rate is unknown' })
  @ApiResponse({ status: 404, description: 'Offer not found in the caller company' })
  simulate(@Body() dto: PriceSimulationDto, @Req() req: AuthenticatedRequest) {
    return this.negotiationService.simulateNegotiation(
      dto.offerId,
      dto.proposedPrice,
      req.user.companyId,
    );
  }
}

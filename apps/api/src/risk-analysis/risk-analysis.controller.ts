import { Controller, Post, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { RiskAnalysisService } from './risk-analysis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('risk-analysis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('risk-analysis')
export class RiskAnalysisController {
  constructor(private readonly riskAnalysisService: RiskAnalysisService) {}

  @Post('analyze/:offerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rule-based risk check of one offer: penalty clauses, loading window, pallet exchange, ADR and reefer against the company fleet, insurance minimum, payment term, cross-border EU transport, Polish risk phrases in the free text. Nothing is saved.' })
  @ApiResponse({ status: 200, description: 'The list of risks (type, level, Polish message, optional details), totalRiskScore (LOW / MEDIUM / HIGH / CRITICAL), safeToAccept (no HIGH risk) and analyzedAt' })
  @ApiResponse({ status: 404, description: 'No offer with this id in the caller\'s company' })
  analyze(@Param('offerId') offerId: string, @Req() req: AuthenticatedRequest) {
    return this.riskAnalysisService.analyzeRisk(offerId, req.user.companyId);
  }
}

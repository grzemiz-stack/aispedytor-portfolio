import { Controller, Get, Post, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AiEvaluationService } from './ai-evaluation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

/** The evaluation result's shape in Swagger: `route` is deprecated. */
const EVALUATION_SCHEMA = {
  type: 'object',
  properties: {
    offerId: { type: 'string' },
    route: { type: 'string', deprecated: true, description: 'Deprecated — countries only ("PL→DE"); the places are in pickup*/delivery*' },
    pickupCity: { type: 'string' },
    pickupCountry: { type: 'string' },
    deliveryCity: { type: 'string' },
    deliveryCountry: { type: 'string' },
    price: { type: 'number', nullable: true, description: 'The offer price in its currency' },
    currency: { type: 'string' },
    score: { type: 'number' },
    priceVsMarket: { type: 'number', nullable: true },
    marginRating: { type: 'string' },
    pricePerKmRating: { type: 'string' },
    routePopularity: { type: 'number' },
    recommendation: { type: 'string' },
    calculatedAt: { type: 'string', format: 'date-time' },
    messages: { type: 'array', items: { type: 'object' } },
  },
};

/**
 * Offer score — a HEURISTIC, not an AI model; no LLM is called
 * (docs/decisions.md §9). The module name and the `ai-evaluation` paths are
 * historical and kept so API clients do not break; the descriptions say what
 * the code actually does.
 */
@ApiTags('ai-evaluation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Controller('ai-evaluation')
export class AiEvaluationController {
  constructor(private readonly aiEvaluationService: AiEvaluationService) {}

  @Post('evaluate/:offerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Heuristic offer score 1–10 (no AI model)',
    description: 'Rules: a base from the offer\'s margin thresholds, adjusted by its price per km against the average of this company\'s other offers on the same country pair (converted to the offer currency with static rates). No model and no LLM call; the name `ai-evaluation` is historical.',
  })
  @ApiResponse({ status: 200, description: 'Score, margin and price-per-km ratings, route popularity, a recommendation text (Polish) and currency codes', schema: EVALUATION_SCHEMA })
  @ApiResponse({ status: 404, description: 'Offer not found in the caller\'s company' })
  evaluateOffer(@Param('offerId') offerId: string, @Req() req: AuthenticatedRequest) {
    return this.aiEvaluationService.evaluateOffer(offerId, req.user.companyId);
  }

  @Get('batch')
  @ApiOperation({ summary: 'Heuristic score (no AI model) for up to 30 newest offers with status NEW, sorted by score' })
  @ApiResponse({ status: 200, description: 'Array of results, highest score first', schema: { type: 'array', items: EVALUATION_SCHEMA } })
  batchEvaluate(@Req() req: AuthenticatedRequest) {
    return this.aiEvaluationService.batchEvaluate(req.user.companyId);
  }
}

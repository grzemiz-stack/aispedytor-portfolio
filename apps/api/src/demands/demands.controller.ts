import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DemandsService } from './demands.service';
import { CreateDemandDto } from './dto/create-demand.dto';
import { UpdateDemandDto } from './dto/update-demand.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('demands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('demands')
export class DemandsController {
  constructor(private readonly demandsService: DemandsService) {}

  @Get()
  @ApiOperation({
    summary: 'List demands (a dispatcher sees only their own)',
    description:
      'The `matchCount` of each item is computed on read from the current offers ' +
      '(the 500 newest with status NEW or ASSIGNED), with the same predicate as the manual ' +
      'search and auto-notifications. It is not stored in the database.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of demands; each item carries the computed `matchCount`',
  })
  findAll(@Req() req: AuthenticatedRequest, @Query() pagination: PaginationDto) {
    return this.demandsService.findAll(
      req.user.companyId,
      pagination,
      req.user.role === 'DISPATCHER' ? req.user.userId : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one demand of the caller\'s company' })
  @ApiResponse({ status: 200, description: 'The demand' })
  @ApiResponse({ status: 404, description: 'Demand not found' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.demandsService.findOne(id, req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a demand owned by the caller' })
  @ApiResponse({ status: 201, description: 'The created demand' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateDemandDto, @Req() req: AuthenticatedRequest) {
    return this.demandsService.create(req.user.companyId, req.user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a demand' })
  @ApiResponse({ status: 200, description: 'The updated demand' })
  @ApiResponse({ status: 404, description: 'Demand not found' })
  update(@Param('id') id: string, @Body() dto: UpdateDemandDto, @Req() req: AuthenticatedRequest) {
    return this.demandsService.update(id, req.user.companyId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a demand' })
  @ApiResponse({ status: 200, description: 'Demand deleted; returns the deleted record' })
  @ApiResponse({ status: 404, description: 'Demand not found' })
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.demandsService.delete(id, req.user.companyId);
  }

  @Post(':id/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search offers matching a demand',
    description:
      'The domain criteria (pickup country, weight, ADR, temperature) are evaluated by the same ' +
      'function as the auto-notification path, so both results agree. An offer that lacks a value ' +
      'needed for a criterion is NOT rejected — the criterion goes into the unknown list. ' +
      'Scans the 500 newest offers with status NEW or ASSIGNED and returns at most 50 matches. ' +
      'Side effects: sets `lastSearchAt`, moves an OPEN demand to IN_PROGRESS and, when anything ' +
      'matched, creates a DEMAND_MATCH notification for the caller.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Matching offers (at most 50; `matchCount` is their number). Each offer carries ' +
      '`matchUnknownCriteria` — criteria that could not be evaluated because the offer lacks ' +
      'the data. `unknownCriteriaSummary` counts them over the returned offers; `scanned` and ' +
      '`scanLimitReached` say how many offers were scanned and whether the scan limit was reached.',
    schema: {
      type: 'object',
      properties: {
        demandId: { type: 'string' },
        matchCount: { type: 'number' },
        offers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              matchUnknownCriteria: {
                type: 'array',
                items: { type: 'string', enum: ['pickupCountry', 'weight', 'adr', 'temperature'] },
              },
            },
          },
        },
        unknownCriteriaSummary: {
          type: 'object',
          additionalProperties: { type: 'number' },
          example: { weight: 3, pickupCountry: 1 },
        },
        scanned: { type: 'number' },
        scanLimitReached: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Demand not found' })
  searchOffers(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.demandsService.searchOffers(id, req.user.companyId, req.user.userId);
  }

  @Post(':id/subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Turn new-offer notifications for a demand on or off' })
  @ApiResponse({ status: 200, description: 'Subscription toggled; returns the new `autoNotify`' })
  toggleSubscription(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.demandsService.toggleSubscription(id, req.user.companyId);
  }
}

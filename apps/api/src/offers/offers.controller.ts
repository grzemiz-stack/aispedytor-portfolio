import { OfferEconomicsPreviewDto } from './dto/offer-economics-preview.dto';
import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OffersService } from './offers.service';
import { ImportOffersDto } from './dto/import-offers.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferQueryDto } from './dto/offer-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateOfferStatusDto } from './dto/update-offer-status.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // Must be before :id to avoid route conflicts
  @Get('stats')
  @ApiOperation({ summary: 'Offer statistics: counts by status and source, revenue and average price per km in the company currency' })
  @ApiResponse({ status: 200, description: 'Totals, counts by status and source, revenue of accepted offers and average price per km converted to the company currency (see `money`), average margin, the 5 newest offers' })
  getStats(@Req() req: AuthenticatedRequest) {
    return this.offersService.getStats(req.user.companyId);
  }


  @Get('search')
  @ApiOperation({
    summary: 'Search offers by pickup country and pickup postal code prefix',
    description:
      'Exact match on the pickup country and a PREFIX match on the pickup ' +
      'postal code (`startsWith`) — not a radius search. `?postal=80` returns ' +
      'every offer whose postal code starts with "80", whatever the distance. ' +
      'The result is a flat array sorted by pickup date ascending, at most ' +
      '100 items, no pagination.',
  })
  @ApiResponse({ status: 200, description: 'Matching offers (a flat array)' })
  @ApiQuery({ name: 'country', required: false, description: 'Pickup country code, exact match' })
  @ApiQuery({ name: 'postal', required: false, description: 'Pickup postal code prefix' })
  search(
    @Req() req: AuthenticatedRequest,
    @Query('country') country?: string,
    @Query('postal') postal?: string,
  ) {
    return this.offersService.search(req.user.companyId, { country, postal });
  }

  @Post('import')
  @ApiOperation({ summary: 'Import offers sent as JSON (`{ source, offers[] }`)' })
  @ApiResponse({ status: 201, description: '`{ imported, duplicates, rejected }`: valid rows saved; duplicates (company + source + externalId) skipped; bad rows in `rejected` as `{ row (from 0), field, code }` — IMPORT_ROW_FIELD_INVALID, IMPORT_ROW_DATE_INVALID, OFFER_VALUE_OUT_OF_RANGE' })
  @ApiResponse({ status: 400, description: 'A bad request structure (no source, offers not a list, a field outside the schema at the top level) — rows never give 400' })
  importOffers(@Body() dto: ImportOffersDto, @Req() req: AuthenticatedRequest) {
    return this.offersService.importOffers(req.user.companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List offers with filters (status, assignee, source) and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of offers (`data`, `meta`)' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: OfferQueryDto) {
    const { status, assignedToId, source, ...pagination } = query;
    return this.offersService.findAll(req.user.companyId, pagination, { status, assignedToId, source });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Offer details' })
  @ApiResponse({ status: 200, description: 'The offer, with its contractor name and country' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.offersService.findOne(id, req.user.companyId);
  }

  @Post('economics-preview')
  @ApiOperation({
    summary: 'Cost, profit and margin preview of an offer (the new-offer and edit forms)',
    description: "The same rule as saving (`offerCost`: the company rate × km + toll). Without a toll the margin is an upper bound (`marginWithoutTolls: true`); the cost codes in `messages`. With `offerId` (the company's offer, otherwise 404) — as `PATCH /offers/:id`: missing fields from the offer, its saved route.",
  })
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, description: '{ totalCostEstimate, profitEstimate, profitMarginPercent, marginWithoutTolls, messages }' })
  economicsPreview(@Body() dto: OfferEconomicsPreviewDto, @Req() req: AuthenticatedRequest) {
    return this.offersService.economicsPreview(req.user.companyId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create an offer' })
  @ApiResponse({ status: 201, description: 'The created offer' })
  @ApiResponse({ status: 400, description: 'Validation error, or `OFFER_CONTRACTOR_NOT_FOUND` (the contractor is not in the caller’s company)' })
  create(@Body() dto: CreateOfferDto, @Req() req: AuthenticatedRequest) {
    return this.offersService.create(req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an offer (only some fields are stored, see known issues)' })
  @ApiResponse({ status: 200, description: 'The updated offer' })
  @ApiResponse({ status: 400, description: 'OFFER_CONTRACTOR_NOT_FOUND — the contractor is not in this company; OFFER_FIELD_NOT_EDITABLE { field } — the source and the external id (the origin, the import key) do not change' })
  @ApiResponse({ status: 403, description: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY — only an ADMIN detaches or replaces a blacklisted contractor; OFFER_FIELDS_ADMIN_ONLY { fields } — an accepted / in-transit / completed offer: price, currency, distance, toll, loading and unloading dates, validity, cities and countries are changed by an ADMIN only' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto, @Req() req: AuthenticatedRequest) {
    return this.offersService.update(id, req.user.companyId, dto, { userId: req.user.userId, role: req.user.role });
  }

  @Patch(':id/assign/:userId')
  @ApiOperation({ summary: 'Assign an offer to a dispatcher (sets the status to ASSIGNED)' })
  @ApiResponse({ status: 200, description: 'The assigned offer' })
  @ApiResponse({ status: 404, description: 'Offer not found, or `OFFER_ASSIGNEE_NOT_FOUND` (no active user with this id in the caller’s company)' })
  assign(@Param('id') id: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    return this.offersService.assign(id, req.user.companyId, userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change the offer status (any OfferStatus value; there are no transition rules)' })
  @ApiResponse({ status: 200, description: 'The offer with the new status' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  updateStatus(@Param('id') id: string, @Body() body: UpdateOfferStatusDto, @Req() req: AuthenticatedRequest) {
    return this.offersService.updateStatus(id, req.user.companyId, body.status, { userId: req.user.userId, role: req.user.role });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an offer' })
  @ApiResponse({ status: 200, description: 'The deleted offer' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.offersService.delete(id, req.user.companyId);
  }
}

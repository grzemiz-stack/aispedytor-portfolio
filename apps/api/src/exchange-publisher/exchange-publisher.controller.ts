import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { ExchangePublisherService, PublishOfferInput } from './exchange-publisher.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/types/authenticated-request';

export class PublishOfferDto implements Omit<PublishOfferInput, 'companyId'> {
  @IsString() originCountry: string;
  @IsString() originCity: string;
  @IsOptional() @IsString() originPostalCode?: string;
  @IsOptional() @IsString() originStreet?: string;
  @IsString() destCountry: string;
  @IsString() destCity: string;
  @IsOptional() @IsString() destPostalCode?: string;
  @IsOptional() @IsString() destStreet?: string;
  @IsString() loadingDateFrom: string;
  @IsString() loadingDateTo: string;
  @IsOptional() @IsString() deliveryDateFrom?: string;
  @IsOptional() @IsString() deliveryDateTo?: string;
  @IsNumber() weightKg: number;
  @IsOptional() @IsNumber() volumeM3?: number;
  @IsOptional() @IsNumber() palletCount?: number;
  @IsOptional() @IsNumber() loadingMeters?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isAdr?: boolean;
  @IsOptional() @IsString() adrClass?: string;
  @IsOptional() @IsBoolean() isRefrigerated?: boolean;
  @IsOptional() @IsNumber() tempFrom?: number;
  @IsOptional() @IsNumber() tempTo?: number;
  @IsOptional() @IsString() vehicleType?: string;
  @IsOptional() @IsString() truckBody?: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() isNegotiable?: boolean;
  @IsOptional() @IsBoolean() publishToTransEu?: boolean;
  @IsOptional() @IsBoolean() publishToTimocom?: boolean;
  @IsOptional() @IsBoolean() publishToPublicExchange?: boolean;
}

@ApiTags('exchange-publisher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('exchange-publisher')
export class ExchangePublisherController {
  constructor(private readonly service: ExchangePublisherService) {}

  @Post('publish')
  @ApiResponse({ status: 201, description: 'Results per exchange; the successful ones are saved in published_offers' })
  @ApiOperation({ summary: 'Publish a load on the freight exchanges chosen by the publishToTransEu / publishToTimocom flags; returns one result per exchange. Timocom has no built-in implementation: without a plugged-in adapter its result is success: false, code TIMOCOM_NOT_IMPLEMENTED' })
  publish(@CurrentUser() user: JwtUser, @Body() dto: PublishOfferDto) {
    return this.service.publishOffer({ ...dto, companyId: user.companyId });
  }

  @Get('published')
  @ApiOperation({ summary: 'Offers this company published successfully, newest first (up to 100)' })
  async getPublished(@CurrentUser() user: JwtUser) {
    return this.service.getPublishedOffers(user.companyId);
  }
}

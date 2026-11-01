import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { OfferGeocodingTask } from './offer-geocoding.task';

@Module({
  providers: [GeocodingService, OfferGeocodingTask],
  exports: [GeocodingService],
})
export class GeocodingModule {}

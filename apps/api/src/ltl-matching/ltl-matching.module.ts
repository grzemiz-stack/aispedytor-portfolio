import { Module } from '@nestjs/common';
import { LtlMatchingController } from './ltl-matching.controller';
import { LtlMatchingService } from './ltl-matching.service';
import { GeocodingModule } from '../geocoding/geocoding.module';

@Module({
  imports: [GeocodingModule],
  controllers: [LtlMatchingController],
  providers: [LtlMatchingService],
  exports: [LtlMatchingService],
})
export class LtlMatchingModule {}

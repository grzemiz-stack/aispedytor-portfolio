import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateOfferDto } from './create-offer.dto';

/** The fields of the margin preview — the same rules as `CreateOfferDto`. */
export class OfferEconomicsPreviewDto extends PickType(CreateOfferDto, ['price', 'currency', 'distanceKm', 'tollCostEstimate'] as const) {
  /** Editing an offer: computed as `PATCH` (missing fields from the offer, its saved route; decisions §3a). */
  @ApiPropertyOptional({ description: "Editing: the company's offer id — computed as PATCH /offers/:id (missing fields from the offer, its saved route)" })
  @IsOptional()
  @IsString()
  offerId?: string;
}

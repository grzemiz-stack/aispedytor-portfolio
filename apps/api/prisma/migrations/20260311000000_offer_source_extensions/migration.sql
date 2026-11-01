-- Add GENERIC and API to OfferSource enum
ALTER TYPE "OfferSource" ADD VALUE 'GENERIC';
ALTER TYPE "OfferSource" ADD VALUE 'API';

-- Add sourceUrl and importedAt to offers
ALTER TABLE "offers" ADD COLUMN "source_url" TEXT;
ALTER TABLE "offers" ADD COLUMN "imported_at" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- AlterTable: add publishStatus column
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "publish_status" TEXT NOT NULL DEFAULT 'none';

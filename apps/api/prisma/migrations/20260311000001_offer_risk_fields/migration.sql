-- Add risk analysis fields to offers table (idempotent)
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "penalty_clauses" TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "loading_time_window" INTEGER;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "unloading_time_window" INTEGER;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "pallet_exchange" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "pallet_exchange_type" TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "pallet_count" INTEGER;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "required_insurance_min" DOUBLE PRECISION;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "payment_term_days" INTEGER;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "special_requirements" TEXT;

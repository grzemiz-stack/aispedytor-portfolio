-- Add core fields to dispatcher_demands
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "needed_by" TIMESTAMP(3);

-- Vehicle requirement fields
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "vehicle_type" TEXT;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "trailer_type" TEXT;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "min_loading_meters" DOUBLE PRECISION;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "max_weight" DOUBLE PRECISION;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "temperature_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "temperature_min" DOUBLE PRECISION;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "temperature_max" DOUBLE PRECISION;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "adr_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "adr_class" TEXT;

-- Subscription / auto-notify
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "auto_notify" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "last_search_at" TIMESTAMP(3);
ALTER TABLE "dispatcher_demands" ADD COLUMN IF NOT EXISTS "match_count" INTEGER NOT NULL DEFAULT 0;

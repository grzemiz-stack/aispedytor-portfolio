-- Vehicle category & trailer support
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vehicle_category" TEXT NOT NULL DEFAULT 'TRUCK';
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "parent_vehicle_id" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "axle_count" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "max_loading_meters" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "max_pallet_count" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "has_adr" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "has_gps" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "planned_maintenance_notes" TEXT;

-- Self-referencing FK for parent_vehicle_id (naczepa → ciągnik)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vehicles_parent_vehicle_id_fkey'
    AND table_name = 'vehicles'
  ) THEN
    ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_parent_vehicle_id_fkey"
      FOREIGN KEY ("parent_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "vehicles_company_id_category_idx" ON "vehicles"("company_id", "vehicle_category");

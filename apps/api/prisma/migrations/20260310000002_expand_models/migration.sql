-- AlterEnum: add vehicle notification types
ALTER TYPE "NotificationType" ADD VALUE 'VEHICLE_INSPECTION_EXPIRY';
ALTER TYPE "NotificationType" ADD VALUE 'VEHICLE_INSURANCE_EXPIRY';
ALTER TYPE "NotificationType" ADD VALUE 'VEHICLE_TACHOGRAPH_EXPIRY';
ALTER TYPE "NotificationType" ADD VALUE 'VEHICLE_MAINTENANCE';

-- AlterTable companies: add logo
ALTER TABLE "companies" ADD COLUMN "logo_base64" TEXT;

-- AlterTable contractors: add contact/status fields
ALTER TABLE "contractors" ADD COLUMN "city" TEXT;
ALTER TABLE "contractors" ADD COLUMN "address" TEXT;
ALTER TABLE "contractors" ADD COLUMN "contact_person" TEXT;
ALTER TABLE "contractors" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "contractors" ADD COLUMN "contact_phone" TEXT;
ALTER TABLE "contractors" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "contractors" ADD COLUMN "rating" INTEGER;

-- AlterTable vehicles: add brand/model/vin/year/docs/inspection fields
ALTER TABLE "vehicles" ADD COLUMN "license_plate" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "ocr_number" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "brand" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "model" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "vin" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "year" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN "technical_inspection_from" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "technical_inspection_to" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "insurance_from" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "insurance_to" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "tachograph_legalization_from" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "tachograph_legalization_to" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "planned_maintenance_date" TIMESTAMP(3);

-- AlterTable offers: add search radius
ALTER TABLE "offers" ADD COLUMN "search_radius" INTEGER;

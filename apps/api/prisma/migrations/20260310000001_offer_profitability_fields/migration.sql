-- AlterTable: add profitability & cost estimation fields to offers
ALTER TABLE "offers" ADD COLUMN "distance_km" DOUBLE PRECISION;
ALTER TABLE "offers" ADD COLUMN "fuel_cost_estimate" DECIMAL(10,2);
ALTER TABLE "offers" ADD COLUMN "toll_cost_estimate" DECIMAL(10,2);
ALTER TABLE "offers" ADD COLUMN "total_cost_estimate" DECIMAL(10,2);
ALTER TABLE "offers" ADD COLUMN "profit_estimate" DECIMAL(10,2);
ALTER TABLE "offers" ADD COLUMN "profit_margin_percent" DECIMAL(5,2);
ALTER TABLE "offers" ADD COLUMN "notes" TEXT;

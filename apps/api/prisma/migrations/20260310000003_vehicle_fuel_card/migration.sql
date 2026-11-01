-- AlterTable vehicles: add fuel card fields (no full number or PIN stored)
ALTER TABLE "vehicles" ADD COLUMN "fuel_card_type" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "fuel_card_last4" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "fuel_card_expiry" TIMESTAMP(3);

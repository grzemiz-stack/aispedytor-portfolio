-- DropForeignKey
ALTER TABLE "email_messages" DROP CONSTRAINT "email_messages_company_id_fkey";

-- DropForeignKey
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_parent_vehicle_id_fkey";

-- DropIndex
DROP INDEX "vehicles_company_id_category_idx";

-- AlterTable
ALTER TABLE "email_messages" ALTER COLUMN "tags" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedOffer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "externalOfferId" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "destCity" TEXT NOT NULL,
    "destCountry" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "PublishedOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeConnection_companyId_idx" ON "ExchangeConnection"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeConnection_companyId_exchange_key" ON "ExchangeConnection"("companyId", "exchange");

-- CreateIndex
CREATE INDEX "PublishedOffer_companyId_idx" ON "PublishedOffer"("companyId");

-- CreateIndex
CREATE INDEX "PublishedOffer_exchange_idx" ON "PublishedOffer"("exchange");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_parent_vehicle_id_fkey" FOREIGN KEY ("parent_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeConnection" ADD CONSTRAINT "ExchangeConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedOffer" ADD CONSTRAINT "PublishedOffer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

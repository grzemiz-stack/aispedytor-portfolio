-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "billing_email" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'PL',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "regon" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "website" TEXT;

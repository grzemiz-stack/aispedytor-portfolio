-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "ai_calls_date" TIMESTAMP(3),
ADD COLUMN     "ai_calls_limit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "ai_calls_today" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

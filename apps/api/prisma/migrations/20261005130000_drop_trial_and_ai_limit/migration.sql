-- Plans, usage limits and billing are out of this product's scope (README).
-- These columns were written at registration and read by nothing.
ALTER TABLE "companies"
  DROP COLUMN "trial_ends_at",
  DROP COLUMN "ai_calls_today",
  DROP COLUMN "ai_calls_date",
  DROP COLUMN "ai_calls_limit";

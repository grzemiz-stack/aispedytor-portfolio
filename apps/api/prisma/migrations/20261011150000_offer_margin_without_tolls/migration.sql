-- A margin without a toll is an upper bound (docs/decisions.md §3a).
-- The column is only added, nothing is removed. Existing margins (computed
-- before by the form from fuel and toll) get `false` until
-- `npm run offers:recompute-economics` recomputes them; no margin stays NULL.
ALTER TABLE "offers" ADD COLUMN "margin_without_tolls" BOOLEAN;
UPDATE "offers" SET "margin_without_tolls" = false WHERE "profit_margin_percent" IS NOT NULL;

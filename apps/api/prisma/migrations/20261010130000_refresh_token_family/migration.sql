-- Refresh tokens: a family per login and reuse detection.
-- Before, rotation deleted the used token, so using it again looked like an
-- unknown token (403) while the stolen chain lived on.
--   family_id — every login starts a family; a refresh keeps it
--   used_at   — set when the token is rotated; the row stays until it expires,
--               so a second use is recognised and the whole family is deleted
-- Existing rows: each is its own family (family_id = id), not used.

ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "used_at" TIMESTAMP(3);
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- Refresh tokens are stored as SHA-256 (hex), not as plain text.
-- Whoever read the database or a copy of it could refresh users' sessions for
-- 7 days. Existing rows are hashed here, in PostgreSQL, with the same function
-- the API uses (SHA-256 of the UTF-8 token, lower-case hex) — the clients keep
-- their tokens and nobody is logged out.

ALTER TABLE "refresh_tokens" ADD COLUMN "token_hash" TEXT;
UPDATE "refresh_tokens" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "refresh_tokens" ALTER COLUMN "token_hash" SET NOT NULL;
DROP INDEX "refresh_tokens_token_key";
ALTER TABLE "refresh_tokens" DROP COLUMN "token";
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

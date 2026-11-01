-- Remove orphan CMRbox models from production schema
--
-- Context: CMRbox module was extracted to grzemiz-stack/Cmr_box repository
-- in commit 90fe691 (May 5, 2026). The corresponding schema models remained
-- in schema.prisma until cleanup in this branch. This migration drops the
-- 5 orphan tables and 7 related enum types.
--
-- Safety: All DROP statements use IF EXISTS, so this migration is idempotent
-- and safe to run on databases where these objects may or may not exist.
-- CASCADE handles any orphan foreign keys.

-- DropTable (in dependency order: leaf tables first)
DROP TABLE IF EXISTS "dispatch_logs" CASCADE;
DROP TABLE IF EXISTS "transport_documents" CASCADE;
DROP TABLE IF EXISTS "document_batches" CASCADE;
DROP TABLE IF EXISTS "dispatch_configs" CASCADE;
DROP TABLE IF EXISTS "drivers" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "DocumentType";
DROP TYPE IF EXISTS "DocumentProcessingStatus";
DROP TYPE IF EXISTS "BatchStatus";
DROP TYPE IF EXISTS "DispatchType";
DROP TYPE IF EXISTS "DispatchMode";
DROP TYPE IF EXISTS "DispatchStatus";
DROP TYPE IF EXISTS "SyncStatus";-- This is an empty migration.

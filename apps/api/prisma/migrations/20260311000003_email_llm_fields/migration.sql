-- Add LLM result fields to email_messages table
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "llm_summary" TEXT;
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "llm_category" TEXT;

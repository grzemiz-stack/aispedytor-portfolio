-- Store full LLM-extracted JSON so createOfferFromEmail can use all fields
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "llm_extracted_data" JSONB;

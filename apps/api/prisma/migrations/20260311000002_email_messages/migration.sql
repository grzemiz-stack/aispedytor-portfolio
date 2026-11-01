-- Create EmailCategory and EmailPriority enums (idempotent)
DO $$ BEGIN
  CREATE TYPE "EmailCategory" AS ENUM ('OFFER', 'INQUIRY', 'COMPLAINT', 'INVOICE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create email_messages table
CREATE TABLE IF NOT EXISTS "email_messages" (
  "id"                       TEXT NOT NULL,
  "company_id"               TEXT NOT NULL,
  "message_id"               TEXT,
  "subject"                  TEXT NOT NULL,
  "from_name"                TEXT,
  "from_email"               TEXT NOT NULL,
  "to_email"                 TEXT NOT NULL,
  "body"                     TEXT NOT NULL,
  "received_at"              TIMESTAMP(3) NOT NULL,
  "category"                 "EmailCategory" NOT NULL DEFAULT 'OTHER',
  "priority"                 "EmailPriority" NOT NULL DEFAULT 'MEDIUM',
  "is_read"                  BOOLEAN NOT NULL DEFAULT false,
  "is_starred"               BOOLEAN NOT NULL DEFAULT false,
  "tags"                     TEXT[] NOT NULL DEFAULT '{}',
  "extracted_pickup_city"    TEXT,
  "extracted_pickup_country" TEXT,
  "extracted_delivery_city"  TEXT,
  "extracted_delivery_country" TEXT,
  "extracted_weight"         DOUBLE PRECISION,
  "extracted_price"          DOUBLE PRECISION,
  "extracted_date"           TIMESTAMP(3),
  "created_offer_id"         TEXT,
  "notes"                    TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_messages_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "email_messages_company_id_is_read_idx"
  ON "email_messages"("company_id", "is_read");

CREATE INDEX IF NOT EXISTS "email_messages_company_id_category_idx"
  ON "email_messages"("company_id", "category");

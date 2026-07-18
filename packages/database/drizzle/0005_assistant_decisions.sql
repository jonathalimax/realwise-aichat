CREATE TABLE IF NOT EXISTS "assistant_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "message_id" uuid NOT NULL REFERENCES "messages"("id"),
  "action" text NOT NULL,
  "confidence" integer NOT NULL,
  "response" text,
  "cited_source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'RECORDED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_decisions_message_unique" ON "assistant_decisions" ("message_id");
CREATE INDEX IF NOT EXISTS "assistant_decisions_tenant_idx" ON "assistant_decisions" ("tenant_id");

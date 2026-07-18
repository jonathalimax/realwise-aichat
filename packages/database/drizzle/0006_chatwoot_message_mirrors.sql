CREATE TABLE IF NOT EXISTS "chatwoot_message_mirrors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "message_id" uuid NOT NULL REFERENCES "messages"("id"),
  "assistant_decision_id" uuid REFERENCES "assistant_decisions"("id"),
  "target_inbox_id" text NOT NULL,
  "status" text DEFAULT 'MOCK_MIRRORED' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "chatwoot_message_mirrors_message_unique" ON "chatwoot_message_mirrors" ("message_id");
CREATE INDEX IF NOT EXISTS "chatwoot_message_mirrors_tenant_idx" ON "chatwoot_message_mirrors" ("tenant_id");

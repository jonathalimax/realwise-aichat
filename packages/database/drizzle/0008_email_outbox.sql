CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "to_email" text NOT NULL,
  "kind" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'MOCK_QUEUED' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_outbox_recipient_idx" ON "email_outbox" ("to_email");
CREATE INDEX IF NOT EXISTS "email_outbox_status_idx" ON "email_outbox" ("status");

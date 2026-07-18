CREATE TABLE IF NOT EXISTS "billing_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "kind" text NOT NULL,
  "provider_session_id" text NOT NULL,
  "url" text NOT NULL,
  "status" text DEFAULT 'MOCK_CREATED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_sessions_provider_session_unique" ON "billing_sessions" ("provider_session_id");
CREATE INDEX IF NOT EXISTS "billing_sessions_tenant_idx" ON "billing_sessions" ("tenant_id");

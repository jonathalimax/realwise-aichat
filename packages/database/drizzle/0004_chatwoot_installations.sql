CREATE TABLE IF NOT EXISTS "chatwoot_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "account_id" text NOT NULL,
  "inbox_id" text NOT NULL,
  "status" text DEFAULT 'MOCK_PROVISIONED' NOT NULL,
  "release_state" "release_state" DEFAULT 'MOCK_VERIFIED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "chatwoot_installations_tenant_unique" ON "chatwoot_installations" ("tenant_id");

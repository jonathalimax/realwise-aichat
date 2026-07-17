CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "messages_per_month" integer NOT NULL,
  "knowledge_sources_limit" integer NOT NULL,
  "team_members_limit" integer NOT NULL,
  "stripe_price_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "plans_code_unique" ON "plans" ("code");

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "plan_id" uuid NOT NULL REFERENCES "plans"("id"),
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenant_unique" ON "subscriptions" ("tenant_id");

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "kind" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_tenant_idempotency_unique" ON "usage_events" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "usage_events_tenant_kind_idx" ON "usage_events" ("tenant_id", "kind");

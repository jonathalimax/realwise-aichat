CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TYPE "provider" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK');
CREATE TYPE "release_state" AS ENUM ('PLANNED', 'IMPLEMENTED_NOT_VERIFIED', 'MOCK_VERIFIED', 'SANDBOX_VERIFIED', 'READY_FOR_EXTERNAL_ACTIVATION', 'PRODUCTION_VERIFIED');
CREATE TYPE "role" AS ENUM ('OWNER', 'ADMIN', 'ATTENDANT', 'BILLING_ADMIN', 'SUPPORT', 'PLATFORM_ADMIN');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text,
  "email_verified_at" timestamp with time zone,
  "mfa_required" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");

CREATE TABLE "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "segment" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "ai_enabled" boolean DEFAULT true NOT NULL,
  "release_state" "release_state" DEFAULT 'IMPLEMENTED_NOT_VERIFIED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" "role" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "memberships" ("tenant_id", "user_id");

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" ("token_hash");
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");

CREATE TABLE "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "email" text NOT NULL,
  "role" "role" NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by_user_id" uuid REFERENCES "users"("id"),
  "accepted_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" ("token_hash");
CREATE INDEX "invitations_tenant_email_idx" ON "invitations" ("tenant_id", "email");

CREATE TABLE "email_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "token_hash" text NOT NULL,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_unique" ON "email_verification_tokens" ("token_hash");
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" ("user_id");

CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "token_hash" text NOT NULL,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" ("token_hash");
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");

CREATE TABLE "channel_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "provider" "provider" NOT NULL,
  "external_asset_id" text,
  "encrypted_credentials" jsonb,
  "status" text DEFAULT 'ACTION_REQUIRED' NOT NULL,
  "release_state" "release_state" DEFAULT 'MOCK_VERIFIED' NOT NULL,
  "last_diagnostic" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "channel_connections_tenant_provider_idx" ON "channel_connections" ("tenant_id", "provider");

CREATE TABLE "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "external_contact_id" text,
  "display_name" text,
  "phone" text,
  "email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "contacts_tenant_idx" ON "contacts" ("tenant_id");
CREATE UNIQUE INDEX "contacts_tenant_external_unique" ON "contacts" ("tenant_id", "external_contact_id");

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "connection_id" uuid NOT NULL REFERENCES "channel_connections"("id"),
  "external_conversation_id" text,
  "ai_paused" boolean DEFAULT false NOT NULL,
  "human_active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "conversations_tenant_external_idx" ON "conversations" ("tenant_id", "external_conversation_id");
CREATE UNIQUE INDEX "conversations_tenant_external_unique" ON "conversations" ("tenant_id", "external_conversation_id");

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "external_event_id" text NOT NULL,
  "external_message_id" text NOT NULL,
  "direction" text NOT NULL,
  "origin" text NOT NULL,
  "text" text,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "messages_tenant_event_unique" ON "messages" ("tenant_id", "external_event_id");

CREATE TABLE "knowledge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "body" text,
  "release_state" "release_state" DEFAULT 'IMPLEMENTED_NOT_VERIFIED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "knowledge_sources_tenant_kind_idx" ON "knowledge_sources" ("tenant_id", "kind");

CREATE TABLE "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "contact_name" text NOT NULL,
  "service" text,
  "preferred_time" text,
  "notes" text,
  "status" text DEFAULT 'NEW' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "leads_tenant_created_idx" ON "leads" ("tenant_id", "created_at");

CREATE TABLE "plans" (
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
CREATE UNIQUE INDEX "plans_code_unique" ON "plans" ("code");

CREATE TABLE "subscriptions" (
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
CREATE UNIQUE INDEX "subscriptions_tenant_unique" ON "subscriptions" ("tenant_id");

CREATE TABLE "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "kind" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "usage_events_tenant_idempotency_unique" ON "usage_events" ("tenant_id", "idempotency_key");
CREATE INDEX "usage_events_tenant_kind_idx" ON "usage_events" ("tenant_id", "kind");

CREATE TABLE "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" "provider" NOT NULL,
  "external_event_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "webhook_events_provider_event_unique" ON "webhook_events" ("provider", "external_event_id");

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "actor_user_id" uuid REFERENCES "users"("id"),
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

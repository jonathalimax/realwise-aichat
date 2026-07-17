ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "external_contact_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_tenant_external_unique" ON "contacts" ("tenant_id", "external_contact_id");
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_tenant_external_unique" ON "conversations" ("tenant_id", "external_conversation_id");

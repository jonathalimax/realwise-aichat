ALTER TABLE "contacts" ADD COLUMN "external_contact_id" text;
CREATE UNIQUE INDEX "contacts_tenant_external_unique" ON "contacts" ("tenant_id", "external_contact_id");
CREATE UNIQUE INDEX "conversations_tenant_external_unique" ON "conversations" ("tenant_id", "external_conversation_id");

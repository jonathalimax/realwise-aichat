import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const providerEnum = pgEnum("provider", ["WHATSAPP", "INSTAGRAM", "FACEBOOK"]);
export const releaseStateEnum = pgEnum("release_state", [
  "PLANNED",
  "IMPLEMENTED_NOT_VERIFIED",
  "MOCK_VERIFIED",
  "SANDBOX_VERIFIED",
  "READY_FOR_EXTERNAL_ACTIVATION",
  "PRODUCTION_VERIFIED",
]);
export const roleEnum = pgEnum("role", ["OWNER", "ADMIN", "ATTENDANT", "BILLING_ADMIN", "SUPPORT", "PLATFORM_ADMIN"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  mfaRequired: boolean("mfa_required").default(false).notNull(),
  ...timestamps,
}, (table) => ({ emailUnique: uniqueIndex("users_email_unique").on(table.email) }));

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  segment: text("segment").notNull(),
  status: text("status").default("ACTIVE").notNull(),
  aiEnabled: boolean("ai_enabled").default(true).notNull(),
  releaseState: releaseStateEnum("release_state").default("IMPLEMENTED_NOT_VERIFIED").notNull(),
  ...timestamps,
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  role: roleEnum("role").notNull(),
  ...timestamps,
}, (table) => ({ tenantUserUnique: uniqueIndex("memberships_tenant_user_unique").on(table.tenantId, table.userId) }));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => ({ tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash), userIdx: index("sessions_user_idx").on(table.userId) }));

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => ({ invitationTokenUnique: uniqueIndex("invitations_token_hash_unique").on(table.tokenHash), tenantEmailIdx: index("invitations_tenant_email_idx").on(table.tenantId, table.email) }));

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => ({ emailVerificationTokenUnique: uniqueIndex("email_verification_tokens_token_hash_unique").on(table.tokenHash), userIdx: index("email_verification_tokens_user_idx").on(table.userId) }));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => ({ passwordResetTokenUnique: uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash), userIdx: index("password_reset_tokens_user_idx").on(table.userId) }));

export const channelConnections = pgTable("channel_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  provider: providerEnum("provider").notNull(),
  externalAssetId: text("external_asset_id"),
  encryptedCredentials: jsonb("encrypted_credentials"),
  status: text("status").default("ACTION_REQUIRED").notNull(),
  releaseState: releaseStateEnum("release_state").default("MOCK_VERIFIED").notNull(),
  lastDiagnostic: jsonb("last_diagnostic"),
  ...timestamps,
}, (table) => ({ tenantProviderIdx: index("channel_connections_tenant_provider_idx").on(table.tenantId, table.provider) }));

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  externalContactId: text("external_contact_id"),
  displayName: text("display_name"),
  phone: text("phone"),
  email: text("email"),
  ...timestamps,
}, (table) => ({ tenantIdx: index("contacts_tenant_idx").on(table.tenantId), tenantExternalUnique: uniqueIndex("contacts_tenant_external_unique").on(table.tenantId, table.externalContactId) }));

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  contactId: uuid("contact_id").references(() => contacts.id).notNull(),
  connectionId: uuid("connection_id").references(() => channelConnections.id).notNull(),
  externalConversationId: text("external_conversation_id"),
  aiPaused: boolean("ai_paused").default(false).notNull(),
  humanActive: boolean("human_active").default(false).notNull(),
  ...timestamps,
}, (table) => ({ tenantExternalIdx: index("conversations_tenant_external_idx").on(table.tenantId, table.externalConversationId), tenantExternalUnique: uniqueIndex("conversations_tenant_external_unique").on(table.tenantId, table.externalConversationId) }));

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id).notNull(),
  externalEventId: text("external_event_id").notNull(),
  externalMessageId: text("external_message_id").notNull(),
  direction: text("direction").notNull(),
  origin: text("origin").notNull(),
  text: text("text"),
  attachments: jsonb("attachments").default([]).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => ({ tenantEventUnique: uniqueIndex("messages_tenant_event_unique").on(table.tenantId, table.externalEventId) }));

export const knowledgeSources = pgTable("knowledge_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  body: text("body"),
  releaseState: releaseStateEnum("release_state").default("IMPLEMENTED_NOT_VERIFIED").notNull(),
  ...timestamps,
}, (table) => ({ tenantKindIdx: index("knowledge_sources_tenant_kind_idx").on(table.tenantId, table.kind) }));

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  contactName: text("contact_name").notNull(),
  service: text("service"),
  preferredTime: text("preferred_time"),
  notes: text("notes"),
  status: text("status").default("NEW").notNull(),
  ...timestamps,
}, (table) => ({ tenantCreatedIdx: index("leads_tenant_created_idx").on(table.tenantId, table.createdAt) }));

export const chatwootInstallations = pgTable("chatwoot_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  accountId: text("account_id").notNull(),
  inboxId: text("inbox_id").notNull(),
  status: text("status").default("MOCK_PROVISIONED").notNull(),
  releaseState: releaseStateEnum("release_state").default("MOCK_VERIFIED").notNull(),
  ...timestamps,
}, (table) => ({ tenantUnique: uniqueIndex("chatwoot_installations_tenant_unique").on(table.tenantId) }));

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  messagesPerMonth: integer("messages_per_month").notNull(),
  knowledgeSourcesLimit: integer("knowledge_sources_limit").notNull(),
  teamMembersLimit: integer("team_members_limit").notNull(),
  stripePriceId: text("stripe_price_id"),
  ...timestamps,
}, (table) => ({ codeUnique: uniqueIndex("plans_code_unique").on(table.code) }));

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  planId: uuid("plan_id").references(() => plans.id).notNull(),
  status: text("status").default("ACTIVE").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  ...timestamps,
}, (table) => ({ tenantUnique: uniqueIndex("subscriptions_tenant_unique").on(table.tenantId) }));

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  kind: text("kind").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  ...timestamps,
}, (table) => ({ tenantIdempotencyUnique: uniqueIndex("usage_events_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey), tenantKindIdx: index("usage_events_tenant_kind_idx").on(table.tenantId, table.kind) }));

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: providerEnum("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => ({ providerEventUnique: uniqueIndex("webhook_events_provider_event_unique").on(table.provider, table.externalEventId) }));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata").default({}).notNull(),
  ...timestamps,
});

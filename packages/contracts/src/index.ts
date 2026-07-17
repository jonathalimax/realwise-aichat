import { z } from "zod";

export const providerSchema = z.enum(["WHATSAPP", "INSTAGRAM", "FACEBOOK"]);
export type Provider = z.infer<typeof providerSchema>;

export const releaseStateSchema = z.enum([
  "PLANNED",
  "IMPLEMENTED_NOT_VERIFIED",
  "MOCK_VERIFIED",
  "SANDBOX_VERIFIED",
  "READY_FOR_EXTERNAL_ACTIVATION",
  "PRODUCTION_VERIFIED",
]);
export type ReleaseState = z.infer<typeof releaseStateSchema>;

export const roleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "ATTENDANT",
  "BILLING_ADMIN",
  "SUPPORT",
  "PLATFORM_ADMIN",
]);
export type Role = z.infer<typeof roleSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  supportCode: z.string(),
  fieldErrors: z.record(z.array(z.string())).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const normalizedMessageSchema = z.object({
  tenantId: z.string().min(1),
  connectionId: z.string().min(1),
  provider: providerSchema,
  externalEventId: z.string().min(1),
  externalMessageId: z.string().min(1),
  externalConversationId: z.string().optional(),
  externalContactId: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  origin: z.enum([
    "META_CUSTOMER",
    "META_WHATSAPP_APP_HUMAN",
    "CHATWOOT_HUMAN",
    "REALWISE_AI",
    "REALWISE_SYSTEM",
  ]),
  text: z.string().nullable(),
  attachments: z.array(
    z.object({
      type: z.string(),
      externalId: z.string().optional(),
      mimeType: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
  occurredAt: z.string().datetime(),
});
export type NormalizedMessage = z.infer<typeof normalizedMessageSchema>;

export const tenantSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  segment: z.string(),
  aiEnabled: z.boolean(),
  releaseState: releaseStateSchema,
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const dashboardSummarySchema = z.object({
  tenant: tenantSummarySchema,
  health: z.object({
    channelsConnected: z.number().int().nonnegative(),
    channelsWithActionRequired: z.number().int().nonnegative(),
    humansWaiting: z.number().int().nonnegative(),
    aiPausedConversations: z.number().int().nonnegative(),
  }),
  usage: z.object({
    messagesUsed: z.number().int().nonnegative(),
    messagesLimit: z.number().int().positive(),
    knowledgeSources: z.number().int().nonnegative(),
  }),
  nextActions: z.array(z.string()),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const knowledgeSourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  kind: z.enum(["FAQ", "TEXT", "PDF", "WEBSITE", "BUSINESS_PROFILE"]),
  releaseState: releaseStateSchema,
  updatedAt: z.string().datetime(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export const leadSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  contactName: z.string(),
  service: z.string().optional(),
  preferredTime: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["NEW", "CONTACTED", "REQUESTED_APPOINTMENT", "CLOSED"]),
  createdAt: z.string().datetime(),
});
export type Lead = z.infer<typeof leadSchema>;

export const assistantDecisionSchema = z.object({
  action: z.enum(["ANSWER", "ASK_CLARIFYING_QUESTION", "HANDOFF", "PAUSE"]),
  confidence: z.number().min(0).max(1),
  response: z.string().nullable(),
  citedSourceIds: z.array(z.string()),
  reason: z.string(),
});
export type AssistantDecision = z.infer<typeof assistantDecisionSchema>;

import { normalizedMessageSchema, providerSchema, type NormalizedMessage, type Provider } from "@realwise/contracts";
import { z } from "zod";

export const mockMetaEventSchema = z.object({
  tenantId: z.string(),
  connectionId: z.string(),
  provider: providerSchema,
  eventId: z.string(),
  messageId: z.string(),
  conversationId: z.string().optional(),
  contactId: z.string(),
  text: z.string().nullable().default(null),
  occurredAt: z.string().datetime().optional(),
});
export type MockMetaEvent = z.infer<typeof mockMetaEventSchema>;

export function normalizeMockMetaEvent(input: MockMetaEvent): NormalizedMessage {
  return normalizedMessageSchema.parse({
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    provider: input.provider,
    externalEventId: input.eventId,
    externalMessageId: input.messageId,
    externalConversationId: input.conversationId,
    externalContactId: input.contactId,
    direction: "INBOUND",
    origin: "META_CUSTOMER",
    text: input.text,
    attachments: [],
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
}

export function providerDisplayName(provider: Provider): string {
  return {
    WHATSAPP: "WhatsApp",
    INSTAGRAM: "Instagram Direct",
    FACEBOOK: "Facebook Messenger",
  }[provider];
}

export function buildOAuthState(tenantId: string, provider: Provider, nonce: string): string {
  return Buffer.from(JSON.stringify({ tenantId, provider, nonce })).toString("base64url");
}

export function parseOAuthState(state: string): { tenantId: string; provider: Provider; nonce: string } {
  const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as unknown;
  return z.object({ tenantId: z.string(), provider: providerSchema, nonce: z.string() }).parse(parsed);
}

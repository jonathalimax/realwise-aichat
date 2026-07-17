import { Injectable } from "@nestjs/common";
import { fakeAssistantDecision } from "@realwise/knowledge";
import type { NormalizedMessage } from "@realwise/contracts";
import { and, eq } from "drizzle-orm";
import { channelConnections, contacts, conversations, knowledgeSources, messages, webhookEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";

@Injectable()
export class MessagingService {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  async acceptNormalizedMessage(message: NormalizedMessage, rawPayload: unknown) {
    const db = this.databaseProvider.optional();
    if (!db) {
      const decision = fakeAssistantDecision(message, [{ id: "source-prices", title: "Planos e preços" }], { humanActive: false, aiEnabled: true });
      return { accepted: true, duplicate: false, persisted: false, assistantDecision: decision };
    }

    const existingEvent = await db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, message.provider), eq(webhookEvents.externalEventId, message.externalEventId))).limit(1);
    if (existingEvent.length > 0) return { accepted: true, duplicate: true, persisted: true, assistantDecision: null };

    await db.insert(webhookEvents).values({ provider: message.provider, externalEventId: message.externalEventId, payload: rawPayload });

    const [connection] = await db.select().from(channelConnections).where(eq(channelConnections.id, message.connectionId)).limit(1);
    const [contact] = await db.insert(contacts).values({
      tenantId: message.tenantId,
      externalContactId: message.externalContactId,
      displayName: message.externalContactId,
    }).onConflictDoUpdate({
      target: [contacts.tenantId, contacts.externalContactId],
      set: { updatedAt: new Date() },
    }).returning();

    if (!contact) throw new Error("Failed to upsert contact");

    const [conversation] = await db.insert(conversations).values({
      tenantId: message.tenantId,
      contactId: contact.id,
      connectionId: connection?.id ?? message.connectionId,
      externalConversationId: message.externalConversationId ?? message.externalContactId,
    }).onConflictDoUpdate({
      target: [conversations.tenantId, conversations.externalConversationId],
      set: { updatedAt: new Date() },
    }).returning();

    if (!conversation) throw new Error("Failed to upsert conversation");

    await db.insert(messages).values({
      tenantId: message.tenantId,
      conversationId: conversation.id,
      externalEventId: message.externalEventId,
      externalMessageId: message.externalMessageId,
      direction: message.direction,
      origin: message.origin,
      text: message.text,
      attachments: message.attachments,
      occurredAt: new Date(message.occurredAt),
    }).onConflictDoNothing();

    const sources = await db.select({ id: knowledgeSources.id, title: knowledgeSources.title }).from(knowledgeSources).where(eq(knowledgeSources.tenantId, message.tenantId)).limit(5);
    const decision = fakeAssistantDecision(message, sources, { humanActive: conversation.humanActive, aiEnabled: true });
    await db.update(webhookEvents).set({ processedAt: new Date(), updatedAt: new Date() }).where(and(eq(webhookEvents.provider, message.provider), eq(webhookEvents.externalEventId, message.externalEventId)));
    return { accepted: true, duplicate: false, persisted: true, assistantDecision: decision };
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { createMessageProcessingQueue, defaultJobOptions, messageJobId } from "@realwise/queue";
import type { NormalizedMessage } from "@realwise/contracts";
import { and, eq } from "drizzle-orm";
import { channelConnections, contacts, conversations, messages, webhookEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";

@Injectable()
export class MessagingService {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  async acceptNormalizedMessage(message: NormalizedMessage, rawPayload: unknown) {
    const db = this.databaseProvider.optional();
    if (!db) {
      return { accepted: true, duplicate: false, persisted: false, queued: false };
    }

    const existingEvent = await db.select().from(webhookEvents).where(and(eq(webhookEvents.provider, message.provider), eq(webhookEvents.externalEventId, message.externalEventId))).limit(1);
    if (existingEvent.length > 0) return { accepted: true, duplicate: true, persisted: true, queued: false };

    await db.insert(webhookEvents).values({ provider: message.provider, externalEventId: message.externalEventId, payload: rawPayload });

    const [connection] = await db.select().from(channelConnections).where(eq(channelConnections.id, message.connectionId)).limit(1);
    if (!connection) throw new Error("Channel connection not found");

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
      connectionId: connection.id,
      externalConversationId: message.externalConversationId ?? message.externalContactId,
    }).onConflictDoUpdate({
      target: [conversations.tenantId, conversations.externalConversationId],
      set: { updatedAt: new Date() },
    }).returning();
    if (!conversation) throw new Error("Failed to upsert conversation");

    const [storedMessage] = await db.insert(messages).values({
      tenantId: message.tenantId,
      conversationId: conversation.id,
      externalEventId: message.externalEventId,
      externalMessageId: message.externalMessageId,
      direction: message.direction,
      origin: message.origin,
      text: message.text,
      attachments: message.attachments,
      occurredAt: new Date(message.occurredAt),
    }).returning();
    if (!storedMessage) throw new Error("Failed to persist message");

    const queue = createMessageProcessingQueue(process.env.REDIS_URL ?? "redis://localhost:6379");
    await queue.add("process-message", {
      tenantId: message.tenantId,
      messageId: storedMessage.id,
      conversationId: conversation.id,
      externalEventId: message.externalEventId,
    }, {
      ...defaultJobOptions,
      jobId: messageJobId({ tenantId: message.tenantId, externalEventId: message.externalEventId }),
    });
    await queue.close();

    return { accepted: true, duplicate: false, persisted: true, queued: true, messageId: storedMessage.id, conversationId: conversation.id };
  }
}

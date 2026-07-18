import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { fakeAssistantDecision } from "@realwise/knowledge";
import { createDatabase, assistantDecisions, chatwootInstallations, chatwootMessageMirrors, conversations, knowledgeSources, messages, tenants, webhookEvents } from "@realwise/database";
import { createRedisConnection, MESSAGE_PROCESSING_QUEUE, type ProcessMessageJob } from "@realwise/queue";
import type { NormalizedMessage } from "@realwise/contracts";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for worker");

const db = createDatabase(databaseUrl);

const worker = new Worker<ProcessMessageJob>(
  MESSAGE_PROCESSING_QUEUE,
  async (job) => {
    const [message] = await db.select().from(messages).where(eq(messages.id, job.data.messageId)).limit(1);
    if (!message) throw new Error(`Message ${job.data.messageId} not found`);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, job.data.conversationId)).limit(1);
    if (!conversation) throw new Error(`Conversation ${job.data.conversationId} not found`);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, job.data.tenantId)).limit(1);
    if (!tenant) throw new Error(`Tenant ${job.data.tenantId} not found`);

    const sources = await db.select({ id: knowledgeSources.id, title: knowledgeSources.title }).from(knowledgeSources).where(eq(knowledgeSources.tenantId, job.data.tenantId)).limit(5);
    const normalized: NormalizedMessage = {
      tenantId: message.tenantId,
      connectionId: conversation.connectionId,
      provider: "WHATSAPP",
      externalEventId: message.externalEventId,
      externalMessageId: message.externalMessageId,
      externalConversationId: conversation.externalConversationId ?? undefined,
      externalContactId: conversation.contactId,
      direction: message.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND",
      origin: message.origin as NormalizedMessage["origin"],
      text: message.text,
      attachments: Array.isArray(message.attachments) ? message.attachments as NormalizedMessage["attachments"] : [],
      occurredAt: message.occurredAt.toISOString(),
    };
    const decision = fakeAssistantDecision(normalized, sources, { humanActive: conversation.humanActive, aiEnabled: tenant.aiEnabled });

    const [storedDecision] = await db.insert(assistantDecisions).values({
      tenantId: job.data.tenantId,
      conversationId: job.data.conversationId,
      messageId: job.data.messageId,
      action: decision.action,
      confidence: Math.round(decision.confidence * 100),
      response: decision.response,
      citedSourceIds: decision.citedSourceIds,
      reason: decision.reason,
      status: decision.action === "HANDOFF" ? "NEEDS_HUMAN" : "RECORDED",
    }).onConflictDoUpdate({
      target: assistantDecisions.messageId,
      set: {
        action: decision.action,
        confidence: Math.round(decision.confidence * 100),
        response: decision.response,
        citedSourceIds: decision.citedSourceIds,
        reason: decision.reason,
        status: decision.action === "HANDOFF" ? "NEEDS_HUMAN" : "RECORDED",
        updatedAt: new Date(),
      },
    }).returning();

    if (decision.action === "HANDOFF") {
      const [installation] = await db.select().from(chatwootInstallations).where(eq(chatwootInstallations.tenantId, job.data.tenantId)).limit(1);
      if (installation && storedDecision) {
        await db.insert(chatwootMessageMirrors).values({
          tenantId: job.data.tenantId,
          conversationId: job.data.conversationId,
          messageId: job.data.messageId,
          assistantDecisionId: storedDecision.id,
          targetInboxId: installation.inboxId,
          status: "MOCK_MIRRORED",
          payload: { text: message.text, decision: decision.action, reason: decision.reason },
        }).onConflictDoUpdate({
          target: chatwootMessageMirrors.messageId,
          set: { updatedAt: new Date(), status: "MOCK_MIRRORED" },
        });
      }
    }

    await db.update(webhookEvents).set({ processedAt: new Date(), updatedAt: new Date() }).where(and(eq(webhookEvents.provider, "WHATSAPP"), eq(webhookEvents.externalEventId, job.data.externalEventId)));
    console.log(JSON.stringify({ event: "message_processed", jobId: job.id, messageId: job.data.messageId }));
  },
  { connection: createRedisConnection(redisUrl) },
);

worker.on("failed", (job, error) => {
  console.error(JSON.stringify({ event: "job_failed", name: job?.name, id: job?.id, error: error.message }));
});

console.log(JSON.stringify({ event: "worker_started", queue: MESSAGE_PROCESSING_QUEUE }));

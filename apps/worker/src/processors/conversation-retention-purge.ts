import { prisma } from "@realwise/db";

// LGPD retention: docs/legal/politica-de-privacidade.md §4 commits to purging conversations and
// messages 12 months after the last contact. This job enforces that commitment — previously it
// was documented policy with no automated enforcement.
const RETENTION_MONTHS = 12;

export async function processConversationRetentionPurge() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  const expired = await prisma.conversation.findMany({
    where: { lastMessageAt: { lt: cutoff } },
    select: { id: true },
  });

  let purgedConversations = 0;
  let purgedMessages = 0;

  for (const { id: conversationId } of expired) {
    try {
      // Message.conversationId and PushSubscription.conversationId are required relations without
      // onDelete: Cascade in the schema, so both must be deleted before their parent conversation
      // to avoid a foreign key violation.
      const { count } = await prisma.message.deleteMany({ where: { conversationId } });
      purgedMessages += count;
      await prisma.pushSubscription.deleteMany({ where: { conversationId } });
      await prisma.conversation.delete({ where: { id: conversationId } });
      purgedConversations += 1;
    } catch (error) {
      console.error(
        `[conversation-retention-purge] failed to purge conversation ${conversationId}, skipping and continuing with the next one`,
        error,
      );
    }
  }

  console.log(
    `[conversation-retention-purge] purged ${purgedConversations} conversation(s) and ${purgedMessages} message(s) older than ${RETENTION_MONTHS} months (cutoff ${cutoff.toISOString()})`,
  );
}

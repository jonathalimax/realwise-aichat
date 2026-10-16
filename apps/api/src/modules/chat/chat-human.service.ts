import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface HumanAuthor {
  memberId: string;
  /** Display name snapshot, e.g. "Maria Souza". */
  name: string;
  /** Role display name snapshot, e.g. "Farmacêutica responsável". */
  roleName: string;
}

/**
 * Human-join support for the visitor chat (niche-agnostic, built for the pharmacy).
 *
 * Contract for other modules (2b's `POST /handoffs/:id/reply`, and any inbox reply):
 *   await chatHuman.recordHumanReply({ businessId, conversationId, author, text })
 * - first message of that person in that conversation => a system message
 *   `{ role: "system", kind: "human_joined", content: "Nome · Função entrou na conversa" }` is written first;
 * - then `{ role: "owner", content: text, authorMemberId, authorRole, authorName }`.
 * It never touches handoff status, pushes or access logs (the caller owns those) and never writes
 * any pharmacist brief into a message.
 */
@Injectable()
export class ChatHumanService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertConversation(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId }, select: { id: true } });
    if (!conversation) throw new NotFoundException("Conversation not found");
  }

  /** Writes the join banner once per person per conversation. Returns the banner row, or null when it already existed. */
  async recordHumanJoin(input: { businessId: string; conversationId: string; author: HumanAuthor }) {
    await this.assertConversation(input.businessId, input.conversationId);
    const { author } = input;
    const existing = await this.prisma.client.message.findFirst({
      where: { conversationId: input.conversationId, businessId: input.businessId, kind: "human_joined", authorMemberId: author.memberId },
    });
    if (existing) return null;
    const banner = await this.prisma.client.message.create({
      data: {
        conversationId: input.conversationId,
        businessId: input.businessId,
        role: "system",
        kind: "human_joined",
        content: `${author.name} · ${author.roleName} entrou na conversa`,
        authorMemberId: author.memberId,
        authorRole: author.roleName,
        authorName: author.name,
        uiData: { type: "human_joined", name: author.name, roleName: author.roleName },
      },
    });
    await this.prisma.client.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
    });
    return banner;
  }

  async recordHumanReply(input: { businessId: string; conversationId: string; author: HumanAuthor; text: string }) {
    const text = input.text.trim();
    if (!text) throw new NotFoundException("Empty reply");
    const joinMessage = await this.recordHumanJoin(input);
    const message = await this.prisma.client.message.create({
      data: {
        conversationId: input.conversationId,
        businessId: input.businessId,
        role: "owner",
        content: text,
        authorMemberId: input.author.memberId,
        authorRole: input.author.roleName,
        authorName: input.author.name,
      },
    });
    await this.prisma.client.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date(), lastOwnerReplyAt: new Date(), lastReadByOwnerAt: new Date(), messageCount: { increment: 1 } },
    });
    return { joinMessage, message };
  }

  /**
   * A person's reply that carries a structured card (pharmacist product suggestion). Same author stamping and join
   * banner as recordHumanReply; `uiData` is stored verbatim (the caller builds the exact payload from the DB).
   */
  async recordHumanCard(input: { businessId: string; conversationId: string; author: HumanAuthor; content: string; uiData: Record<string, unknown> }) {
    const content = input.content.trim();
    if (!content) throw new NotFoundException("Empty reply");
    const joinMessage = await this.recordHumanJoin(input);
    const message = await this.prisma.client.message.create({
      data: {
        conversationId: input.conversationId,
        businessId: input.businessId,
        role: "owner",
        content,
        authorMemberId: input.author.memberId,
        authorRole: input.author.roleName,
        authorName: input.author.name,
        uiData: input.uiData as object,
      },
    });
    await this.prisma.client.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date(), lastOwnerReplyAt: new Date(), lastReadByOwnerAt: new Date(), messageCount: { increment: 1 } },
    });
    return { joinMessage, message };
  }

  /** One neutral system line in the conversation (e.g. "Nome · Função continuou o atendimento pelo WhatsApp"). Carries no health data. */
  async recordSystemNote(input: { businessId: string; conversationId: string; author: HumanAuthor; text: string }) {
    await this.assertConversation(input.businessId, input.conversationId);
    const message = await this.prisma.client.message.create({
      data: {
        conversationId: input.conversationId,
        businessId: input.businessId,
        role: "system",
        content: input.text.trim().slice(0, 300),
        authorMemberId: input.author.memberId,
        authorRole: input.author.roleName,
        authorName: input.author.name,
      },
    });
    await this.prisma.client.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
    });
    return message;
  }
}

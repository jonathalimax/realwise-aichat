import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(businessId: string, filter?: "all" | "escalated") {
    const conversations = await this.prisma.client.conversation.findMany({
      where: { businessId, ...(filter === "escalated" ? { status: "escalated" } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: { lead: { select: { name: true, phone: true, commitmentScore: true, scoreBand: true } } },
    });

    if (conversations.length === 0) return [];

    // Batch-fetch the last message per conversation in one query instead of N+1 round trips.
    const lastMessages = await this.prisma.client.message.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
      orderBy: { createdAt: "desc" },
      select: { conversationId: true, content: true, createdAt: true },
    });
    const previewByConversation = new Map<string, string>();
    for (const m of lastMessages) {
      if (!previewByConversation.has(m.conversationId)) {
        previewByConversation.set(m.conversationId, m.content.length > 120 ? `${m.content.slice(0, 120)}...` : m.content);
      }
    }

    return conversations.map((c) => ({
      id: c.id,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      escalatedAt: c.escalatedAt,
      referenceCode: c.referenceCode,
      messageCount: c.messageCount,
      lead: c.lead,
      unread: c.lastMessageAt > (c.lastReadByOwnerAt ?? c.startedAt),
      preview: previewByConversation.get(c.id) ?? "",
    }));
  }

  async getThread(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const messages = await this.prisma.client.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    return {
      id: conversation.id,
      status: conversation.status,
      resumeToken: conversation.resumeToken,
      referenceCode: conversation.referenceCode,
      messages,
    };
  }

  async markRead(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: { lastReadByOwnerAt: new Date() },
    });
  }

  async sendOwnerMessage(businessId: string, conversationId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) {
      throw new BadRequestException("Mensagem inválida: não pode estar vazia e deve ter até 2000 caracteres.");
    }

    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");

    if (conversation.status !== "escalated") {
      throw new BadRequestException("Só é possível responder conversas escaladas para atendimento humano.");
    }

    const message = await this.prisma.client.message.create({
      data: { role: "owner", businessId, conversationId, content: trimmed },
    });

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastOwnerReplyAt: new Date(),
        lastReadByOwnerAt: new Date(),
        messageCount: { increment: 1 },
      },
    });

    return message;
  }
}

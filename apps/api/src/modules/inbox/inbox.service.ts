import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { ChatService } from "../chat/chat.service";
import { ListingsService, type ListingItem } from "../listings/listings.service";
import { getPersona } from "../chat/personas";

// Visitor is considered "live" (actively polling the chat, will see the owner's reply within a
// few seconds via the existing poll loop) if they were seen more recently than this — in which
// case a push notification would just be redundant noise.
const VISITOR_LIVE_WINDOW_MS = 45_000;

function isVisitorLive(seenAt: Date | null) {
  return !!seenAt && Date.now() - seenAt.getTime() < VISITOR_LIVE_WINDOW_MS;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly chat: ChatService,
    private readonly listingsService: ListingsService,
  ) {}

  async listConversations(businessId: string, filter?: "all" | "escalated") {
    const conversations = await this.prisma.client.conversation.findMany({
      where: { businessId, ...(filter === "escalated" ? { status: "escalated" } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: { lead: { select: { id: true, name: true, phone: true, commitmentScore: true, scoreBand: true } } },
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
      lastVisitorSeenAt: c.lastVisitorSeenAt,
      visitorOnline: isVisitorLive(c.lastVisitorSeenAt),
      escalationReason: c.flowNodeId === "callback_ok" ? "callback" : null,
      needsLiveAttention: c.status === "escalated" && isVisitorLive(c.lastVisitorSeenAt),
    }));
  }

  async getThread(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      include: { business: { select: { niche: true } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const messages = await this.prisma.client.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    // Re-hydrate listing cards attached to past turns (Message.listingIds) against the live
    // Listing table, same batched-lookup pattern ChatService.getHistory uses to replay a
    // conversation to the visitor — this is the "mirror what the visitor saw" requirement applied
    // to the owner's inbox thread view.
    const allListingIds = [...new Set(messages.flatMap((m) => m.listingIds))];
    const listingsById = new Map(
      allListingIds.length > 0
        ? (await this.listingsService.findByIdsForChat(businessId, allListingIds)).map((l) => [l.id as string, l])
        : [],
    );
    const messagesWithListings = messages.map((m) => {
      if (m.listingIds.length === 0) return m;
      const listings = m.listingIds.map((id) => listingsById.get(id)).filter((l): l is ListingItem => Boolean(l));
      return listings.length > 0 ? { ...m, listings } : m;
    });

    return {
      id: conversation.id,
      status: conversation.status,
      resumeToken: conversation.resumeToken,
      referenceCode: conversation.referenceCode,
      visitorOnline: isVisitorLive(conversation.lastVisitorSeenAt),
      escalationReason: conversation.flowNodeId === "callback_ok" ? "callback" : null,
      // The real assistant label the visitor saw (persona name), so the owner's mirror view never
      // hardcodes "Clara" for a tenant whose persona is actually "Tom" (concessionaria). `niche` is
      // also surfaced so MessageMirror's financing-simulation card picks the right
      // vehicles/imóveis copy, same as SimulationCard.tsx does in the live chat.
      personaName: getPersona(conversation.business.niche).name,
      niche: conversation.business.niche,
      messages: messagesWithListings,
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

  async closeConversation(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      include: { business: { select: { niche: true, name: true } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    if (conversation.status !== "escalated") {
      throw new BadRequestException("Só é possível encerrar conversas escaladas para atendimento humano.");
    }

    await this.prisma.client.message.create({
      data: {
        conversationId,
        businessId,
        role: "system",
        content: `${conversation.business.name} encerrou o atendimento — ${getPersona(conversation.business.niche).name} voltou a responder por aqui.`,
      },
    });

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: {
        status: "active",
        lastMessageAt: new Date(),
        lastOwnerReplyAt: new Date(),
        lastReadByOwnerAt: new Date(),
        messageCount: { increment: 1 },
      },
    });

    return { id: conversation.id, status: "active" };
  }

  async sendOwnerMessage(businessId: string, conversationId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) {
      throw new BadRequestException("Mensagem inválida: não pode estar vazia e deve ter até 2000 caracteres.");
    }

    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      include: { business: { select: { slug: true, name: true } } },
    });
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

    // Visitor is actively polling the chat (within VISITOR_LIVE_WINDOW_MS) — they'll see this
    // reply within a few seconds via the existing poll loop, so a push would just be redundant.
    const visitorIsLive = isVisitorLive(conversation.lastVisitorSeenAt);
    if (!visitorIsLive) {
      const url = this.chat.buildResumeLink(conversation.business, conversation);
      this.push
        .sendToConversation(conversationId, {
          title: conversation.business.name,
          body: trimmed.slice(0, 120),
          url,
          tag: `owner-reply-${conversationId}`,
        })
        .catch(() => {});
    }

    return message;
  }
}

import { Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { buildWaMeLink, buildCustomerEscalationMessage, generateReferenceCode } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";

const ESCALATION_KEYWORDS = ["falar com atendente", "falar com uma pessoa", "humano", "atendente"];

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateConversation(businessId: string, visitorToken: string, leadId?: string) {
    let conversation = await this.prisma.client.conversation.findFirst({
      where: { businessId, visitorToken, status: { in: ["active", "idle"] } },
      orderBy: { startedAt: "desc" },
    });
    if (!conversation) {
      conversation = await this.prisma.client.conversation.create({
        data: { businessId, visitorToken, leadId, status: "active" },
      });
    }
    return conversation;
  }

  async initialChips(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const template = nicheTemplates[business.niche];
    return template?.defaultChips ?? [];
  }

  private detectsEscalation(text: string): boolean {
    const normalized = text.toLowerCase();
    return ESCALATION_KEYWORDS.some((kw) => normalized.includes(kw));
  }

  async sendMessage(businessId: string, conversationId: string, visitorText: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");

    await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "visitor", content: visitorText },
    });

    if (this.detectsEscalation(visitorText)) {
      return this.escalate(businessId, conversationId, visitorText);
    }

    // TODO: route to apps/inference-gateway for RAG once a model is selected (see ai/evals results).
    const answer = "Deixa eu confirmar essa informação com um atendente e já te retorno.";
    const assistantMessage = await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "assistant", content: answer, answerSource: "abstained" },
    });

    return { message: assistantMessage, escalated: false };
  }

  async escalate(businessId: string, conversationId: string, topic: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const routingNumber = await this.prisma.client.whatsappRoutingNumber.findFirst({
      where: { businessId, isActive: true },
      orderBy: { priority: "asc" },
    });
    if (!routingNumber) throw new NotFoundException("No active WhatsApp routing number configured");

    const referenceCode = generateReferenceCode();
    const message = buildCustomerEscalationMessage(business.name, topic, referenceCode);
    const url = buildWaMeLink(routingNumber.phone, message);

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: { status: "escalated", escalatedAt: new Date(), escalationNumberId: routingNumber.id, referenceCode },
    });

    const assistantMessage = await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "assistant", content: "Vou te passar pra uma pessoa do time.", answerSource: "escalation" },
    });

    return { message: assistantMessage, escalated: true, whatsappUrl: url, referenceCode };
  }
}

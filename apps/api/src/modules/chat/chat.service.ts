import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { buildWaMeLink, buildCustomerEscalationMessage, generateReferenceCode } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { BookingsService } from "../bookings/bookings.service";

const ABSTENTION_FALLBACK = "Essa eu não tenho aqui. Quer que eu te passe pro atendimento?";

const ESCALATION_KEYWORDS = ["falar com atendente", "falar com uma pessoa", "humano", "atendente"];

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingsService) {}

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

  async sendMessage(businessId: string, conversationId: string, visitorText: string, visitorToken: string, leadId?: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const belongsToCaller =
      conversation.visitorToken === visitorToken || (leadId && conversation.leadId === leadId);
    if (!belongsToCaller) {
      throw new ForbiddenException("Conversation does not belong to this visitor");
    }

    await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "visitor", content: visitorText },
    });

    if (this.detectsEscalation(visitorText)) {
      return this.escalate(businessId, conversationId, visitorText);
    }

    const answer = await this.generateAnswer(businessId, conversationId, visitorText);
    const assistantMessage = await this.prisma.client.message.create({
      data: {
        conversationId,
        businessId,
        role: "assistant",
        content: answer.text,
        answerSource: answer.abstained ? "abstained" : "rag",
        modelUsed: answer.model,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        latencyMs: answer.latencyMs,
      },
    });

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 2 }, llmTurns: { increment: 1 } },
    });

    return { message: assistantMessage, escalated: false };
  }

  private async generateAnswer(businessId: string, conversationId: string, visitorText: string) {
    const [business, profile, recentMessages] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
      this.prisma.client.businessProfile.findUnique({ where: { businessId } }),
      this.prisma.client.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);

    if (!business) throw new NotFoundException("Business not found");

    const profileSummary = profile?.cachedSummary ?? JSON.stringify(profile?.data ?? {});
    const history = recentMessages
      .reverse()
      .map((m) => `${m.role === "visitor" ? "Cliente" : "Atendente"}: ${m.content}`)
      .join("\n");

    const systemPrompt = [
      `Você é o atendente de IA da ${business.name}, um negócio de ${business.niche === "imobiliaria" ? "locação imobiliária" : "concessionária de veículos"}.`,
      "Responda apenas com base nas informações abaixo. Se não souber, diga que vai confirmar com um atendente humano — nunca invente preço, prazo ou disponibilidade.",
      `Informações do negócio: ${profileSummary}`,
    ].join("\n");

    const prompt = `${history}\nCliente: ${visitorText}`;

    try {
      const result = await generateFromGateway({
        purpose: "chat",
        businessId,
        systemPrompt,
        prompt,
      });
      return { text: result.text, abstained: false, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs };
    } catch {
      return { text: ABSTENTION_FALLBACK, abstained: true, model: undefined, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    }
  }

  private readonly ALLOWED_SERVICES = new Set(["Visita ao imóvel", "Test-drive"]);
  private readonly MAX_BOOKING_DURATION_MS = 4 * 60 * 60 * 1000;

  async bookAppointment(
    businessId: string,
    conversationId: string,
    leadId: string | undefined,
    serviceName: string,
    startsAt: string,
    endsAt: string,
    visitorToken: string,
  ) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    const belongsToCaller =
      conversation.visitorToken === visitorToken || (leadId && conversation.leadId === leadId);
    if (!belongsToCaller) throw new ForbiddenException("Conversation does not belong to this visitor");

    if (!this.ALLOWED_SERVICES.has(serviceName)) {
      throw new ForbiddenException("Invalid service name");
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const now = new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ForbiddenException("Invalid date");
    }
    if (start <= now) throw new ForbiddenException("Start time must be in the future");
    if (end <= start || end.getTime() - start.getTime() > this.MAX_BOOKING_DURATION_MS) {
      throw new ForbiddenException("Invalid appointment duration");
    }

    const appointment = await this.bookings.createAppointment(
      businessId,
      leadId,
      conversationId,
      serviceName,
      new Date(startsAt),
      new Date(endsAt),
      "chat",
    );
    await this.prisma.client.message.create({
      data: {
        conversationId,
        businessId,
        role: "assistant",
        content: `Agendado: ${serviceName} em ${new Date(startsAt).toLocaleString("pt-BR")}. Vamos confirmar com você em breve.`,
        answerSource: "fixed_flow",
      },
    });
    return appointment;
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

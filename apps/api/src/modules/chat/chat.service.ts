import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { buildWaMeLink, buildCustomerEscalationMessage, generateReferenceCode } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { BookingsService } from "../bookings/bookings.service";

const ABSTENTION_FALLBACK = "Essa eu não tenho aqui. Quer que eu te passe pro atendimento?";

const ESCALATION_KEYWORDS = ["falar com atendente", "falar com uma pessoa", "humano", "atendente"];
const AFFIRMATIVE_REPLIES = ["sim", "sim por favor", "pode", "pode ser", "claro", "quero", "por favor", "ok", "okay", "isso"];
const ABSTENTION_MARKERS = [
  "não tenho essa informação",
  "não sei",
  "vou confirmar",
  "deixa eu confirmar",
  "não tenho certeza",
  "preciso verificar",
  "não tenho aqui",
  "passar o atendimento",
  "colega humano",
];

function looksLikeAbstention(text: string): boolean {
  const normalized = text.toLowerCase();
  return ABSTENTION_MARKERS.some((marker) => normalized.includes(marker));
}

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

  // Chips are precomputed — this is a read of the cached value, never an inference call, so
  // opening the chat is instant. Regeneration happens out-of-band via regenerateChips().
  async initialChips(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    if (Array.isArray(business.cachedChips) && business.cachedChips.length > 0) {
      return business.cachedChips as string[];
    }
    const template = nicheTemplates[business.niche];
    return template?.defaultChips ?? [];
  }

  // Triggered when the knowledge base actually changes (document processed, website synced,
  // interview field updated) — never from a chat page load.
  async regenerateChips(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const template = nicheTemplates[business.niche];
    const fallback = template?.defaultChips ?? [];

    const [profile, chunks] = await Promise.all([
      this.prisma.client.businessProfile.findUnique({ where: { businessId } }),
      this.prisma.client.knowledgeChunk.findMany({
        where: { businessId },
        orderBy: [{ document: { createdAt: "desc" } }, { ordinal: "asc" }],
        take: 12,
        select: { content: true },
      }),
    ]);

    const profileSummary = profile?.cachedSummary ?? JSON.stringify(profile?.data ?? {});
    const chunkText = chunks.map((c) => c.content).join("\n\n").slice(0, 6000);

    let chips = fallback;
    if (chunkText || (profile?.data && Object.keys(profile.data as object).length > 0)) {
      const systemPrompt = [
        `Você gera sugestões de pergunta (chips) para o início do chat da ${business.name}, antes do cliente ter dito qualquer coisa.`,
        "Gere exatamente 4 perguntas curtas (no máximo 6 palavras cada), amplas e válidas para o negócio como um todo — NUNCA sobre um item/imóvel/veículo específico pelo nome, já que o cliente ainda não sabe quais itens existem.",
        "Pense em dúvidas transversais que qualquer cliente teria logo de cara: quantidade/catálogo disponível, documentos ou requisitos, política geral (pets, fiador, financiamento), como agendar, horário de atendimento, formas de pagamento.",
        "Baseie-se SOMENTE no conteúdo abaixo para saber quais dessas dúvidas fazem sentido para este negócio — nunca invente informação, mas não cite nomes próprios de imóveis, veículos ou produtos individuais.",
        "Responda apenas com um array JSON de strings, sem nenhum texto adicional.",
        `Informações do negócio: ${profileSummary}`,
        `Conteúdo da base de conhecimento: ${chunkText}`,
      ].join("\n");

      try {
        const result = await generateFromGateway({
          purpose: "chips",
          businessId,
          systemPrompt,
          prompt: "Gere os 4 chips.",
          maxTokens: 150,
        });
        const parsed = JSON.parse(result.text.trim());
        if (Array.isArray(parsed) && parsed.every((c) => typeof c === "string") && parsed.length > 0) {
          chips = parsed.slice(0, 4);
        }
      } catch {
        // keep fallback
      }
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { cachedChips: chips as any, cachedChipsAt: new Date() },
    });
    return chips;
  }

  private detectsEscalation(text: string): boolean {
    const normalized = text.toLowerCase();
    return ESCALATION_KEYWORDS.some((kw) => normalized.includes(kw));
  }

  private confirmsEscalation(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return AFFIRMATIVE_REPLIES.some((kw) => normalized === kw || normalized.startsWith(`${kw} `));
  }

  async sendMessage(businessId: string, conversationId: string, visitorText: string, visitorToken: string, leadId?: string) {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const belongsToCaller =
      conversation.visitorToken === visitorToken || (leadId && conversation.leadId === leadId);
    if (!belongsToCaller) {
      throw new ForbiddenException("Conversation does not belong to this visitor");
    }

    // If Clara's last reply abstained and offered to hand off, and the visitor just confirms
    // ("sim"), that confirmation never contains an escalation keyword — without this check the
    // model would go on to claim it escalated in plain text without any handoff actually happening.
    const lastAssistantMessage = await this.prisma.client.message.findFirst({
      where: { conversationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    const offeredHandoff = lastAssistantMessage?.answerSource === "abstained";

    await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "visitor", content: visitorText },
    });

    if (this.detectsEscalation(visitorText) || (offeredHandoff && this.confirmsEscalation(visitorText))) {
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
      `Você é a Clara, a atendente de IA da ${business.name}, um negócio de ${business.niche === "imobiliaria" ? "locação imobiliária" : "concessionária de veículos"}.`,
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
      return {
        text: result.text,
        abstained: looksLikeAbstention(result.text),
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      };
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

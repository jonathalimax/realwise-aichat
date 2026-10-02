import { Injectable, NotFoundException } from "@nestjs/common";
import { buildWaMeLink, buildOwnerOutreachMessage } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { computeLeadScore, type LeadSignalInputs } from "./lead-scoring";

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForBusiness(businessId: string) {
    return this.prisma.client.lead.findMany({
      where: { businessId },
      orderBy: { commitmentScore: "desc" },
    });
  }

  async getDetail(businessId: string, leadId: string) {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId, businessId },
      include: { conversations: { orderBy: { startedAt: "desc" } } },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  async recomputeScore(businessId: string, leadId: string, inputs: LeadSignalInputs) {
    const { score, band, signals } = computeLeadScore(inputs);
    return this.prisma.client.lead.update({
      where: { id: leadId },
      data: { commitmentScore: score, scoreBand: band, scoreSignals: signals as any },
    });
  }

  private readonly PRICE_KEYWORDS = ["preço", "preco", "valor", "quanto custa", "quanto é", "custo"];
  private readonly AVAILABILITY_KEYWORDS = ["disponível", "disponivel", "disponibilidade", "tem vaga", "tem horário"];
  private readonly LOCATION_KEYWORDS = ["localização", "localizacao", "endereço", "endereco", "onde fica", "onde é"];
  private readonly PAYMENT_KEYWORDS = ["pagamento", "financiamento", "parcelado", "parcelas", "entrada", "à vista"];
  private readonly SPECIFIC_ITEM_KEYWORDS = ["esse", "essa", "aquele", "aquela", "modelo", "unidade", "apartamento", "casa", "carro"];

  // Pulls real conversation/appointment/message signal for a lead straight from the DB so
  // recomputeScore always reflects current behavior, not whatever the caller happens to pass in.
  async recomputeScoreForLead(businessId: string, leadId: string) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) return null;

    const [conversations, appointments] = await Promise.all([
      this.prisma.client.conversation.findMany({ where: { leadId }, include: { messages: true } }),
      this.prisma.client.appointment.findMany({ where: { leadId } }),
    ]);

    const visitorTexts = conversations.flatMap((c) => c.messages.filter((m) => m.role === "visitor").map((m) => m.content.toLowerCase()));
    const messageCount = conversations.reduce((sum, c) => sum + c.messages.length, 0);
    const matchesAny = (keywords: string[]) => visitorTexts.some((t) => keywords.some((kw) => t.includes(kw)));
    const weeksSinceLastActivity = Math.max(0, Math.floor((Date.now() - lead.lastSeenAt.getTime()) / (7 * 24 * 3600 * 1000)));

    const inputs: LeadSignalInputs = {
      hasNameAndPhone: Boolean(lead.name),
      messageCount,
      askedPrice: matchesAny(this.PRICE_KEYWORDS),
      askedAvailability: matchesAny(this.AVAILABILITY_KEYWORDS),
      startedBooking: appointments.length > 0,
      completedBooking: appointments.some((a) => a.status === "completed" || a.status === "confirmed"),
      askedLocation: matchesAny(this.LOCATION_KEYWORDS),
      askedPaymentOrFinancing: matchesAny(this.PAYMENT_KEYWORDS),
      requestedEscalation: conversations.some((c) => c.escalatedAt !== null),
      isReturningVisitor: lead.sessionCount > 1,
      sentDocument: false,
      askedSpecificItem: matchesAny(this.SPECIFIC_ITEM_KEYWORDS),
      weeksSinceLastActivity,
    };

    return this.recomputeScore(businessId, leadId, inputs);
  }

  async markOutcome(businessId: string, leadId: string, outcome: "won" | "lost" | "no_response") {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return this.prisma.client.lead.update({ where: { id: leadId }, data: { ownerOutcome: outcome } });
  }

  // Hot/warm leads gone quiet 24h+ with no appointment or escalation follow-up — the ones worth a direct owner nudge.
  async getCoolingLeads(businessId: string) {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const leads = await this.prisma.client.lead.findMany({
      where: {
        businessId,
        scoreBand: { in: ["hot", "warm"] },
        lastSeenAt: { lte: since24h },
        appointments: { none: {} },
        conversations: { none: { escalatedAt: { not: null } } },
      },
      select: { id: true },
      orderBy: { lastSeenAt: "asc" },
    });
    return { count: leads.length, leadIds: leads.map((l) => l.id) };
  }

  async buildWhatsappLink(businessId: string, leadId: string, topic: string) {
    const [lead, business] = await Promise.all([
      this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } }),
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
    ]);
    if (!lead || !business) throw new NotFoundException("Lead or business not found");

    const message = buildOwnerOutreachMessage(lead.name ?? "", business.name, topic);
    const url = buildWaMeLink(lead.phone, message);

    await this.prisma.client.lead.update({ where: { id: lead.id }, data: { whatsappContactedAt: new Date() } });
    return { url };
  }
}

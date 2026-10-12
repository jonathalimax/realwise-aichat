import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { buildWaMeLink, buildOwnerOutreachMessage } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { computeLeadScore, type LeadSignalInputs } from "./lead-scoring";
import { isLeadStatus, nextLeadStatus, statusUpdateFields, type LeadStatusTrigger } from "./lead-status";
import { coerceEngagementState } from "./engagement-summary";
import { resolveTopicFrom } from "../chat/escalation-topic";

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
      include: {
        conversations: {
          orderBy: { startedAt: "desc" },
          select: { id: true, status: true, startedAt: true, lastMessageAt: true, messageCount: true, referenceCode: true, teamSummary: true },
        },
        appointments: {
          orderBy: { startsAt: "desc" },
          take: 10,
          select: { id: true, serviceName: true, startsAt: true, status: true, notes: true, listingId: true },
        },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");

    // Listings of interest in the lead's own ranked order — includes sold/rented/inactive ones on
    // purpose (the team still needs to know what the lead wanted, e.g. to offer something similar).
    const listings = lead.interestListingIds.length
      ? await this.prisma.client.listing.findMany({
          where: { businessId, id: { in: lead.interestListingIds } },
          select: { id: true, title: true, referenceCode: true, priceText: true, priceCents: true, pricePeriod: true, status: true, neighborhood: true, transaction: true },
        })
      : [];
    const byId = new Map(listings.map((l) => [l.id, l]));
    const interestListings = lead.interestListingIds.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
    return { ...lead, interestListings };
  }

  // Manual status change from the dashboard (any status, including closed_won "vendido/alugado").
  async updateStatus(businessId: string, leadId: string, status: unknown) {
    if (!isLeadStatus(status)) throw new BadRequestException("Invalid status");
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return this.prisma.client.lead.update({ where: { id: leadId }, data: statusUpdateFields(lead, status) });
  }

  async updateNotes(businessId: string, leadId: string, notes: unknown) {
    if (typeof notes !== "string" || notes.length > 4000) throw new BadRequestException("Invalid notes");
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { id: true } });
    if (!lead) throw new NotFoundException("Lead not found");
    return this.prisma.client.lead.update({ where: { id: leadId }, data: { ownerNotes: notes.trim() || null } });
  }

  // Automatic forward-only transition (see lead-status.ts) — never reopens or overrides a status
  // the business set by hand.
  async advanceStatus(businessId: string, leadId: string, trigger: LeadStatusTrigger) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { status: true, closedAt: true } });
    if (!lead) return null;
    const next = nextLeadStatus(lead.status, trigger);
    if (!next) return null;
    return this.prisma.client.lead.update({ where: { id: leadId }, data: statusUpdateFields(lead, next) });
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

    const engagementStates = conversations.map((c) => coerceEngagementState(c.engagementState));
    const activeAppointments = appointments.filter((a) => a.status !== "canceled");
    const visitorTexts = conversations.flatMap((c) => c.messages.filter((m) => m.role === "visitor").map((m) => m.content.toLowerCase()));
    const messageCount = conversations.reduce((sum, c) => sum + c.messages.length, 0);
    const matchesAny = (keywords: string[]) => visitorTexts.some((t) => keywords.some((kw) => t.includes(kw)));
    const weeksSinceLastActivity = Math.max(0, Math.floor((Date.now() - lead.lastSeenAt.getTime()) / (7 * 24 * 3600 * 1000)));

    const inputs: LeadSignalInputs = {
      hasNameAndPhone: Boolean(lead.name),
      messageCount,
      askedPrice: matchesAny(this.PRICE_KEYWORDS),
      askedAvailability: matchesAny(this.AVAILABILITY_KEYWORDS),
      startedBooking: activeAppointments.length > 0,
      completedBooking: activeAppointments.some((a) => a.status === "completed" || a.status === "confirmed"),
      askedLocation: matchesAny(this.LOCATION_KEYWORDS),
      askedPaymentOrFinancing: matchesAny(this.PAYMENT_KEYWORDS),
      requestedEscalation: conversations.some((c) => c.escalatedAt !== null),
      isReturningVisitor: lead.sessionCount > 1,
      sentDocument: false,
      askedSpecificItem: matchesAny(this.SPECIFIC_ITEM_KEYWORDS),
      weeksSinceLastActivity,
      selectedListing: conversations.some((c) => c.selectedListingIds.length > 0),
      statedBudget: engagementStates.some((s) => typeof s.budgetCents === "number"),
    };

    return this.recomputeScore(businessId, leadId, inputs);
  }

  async markOutcome(businessId: string, leadId: string, outcome: "won" | "lost" | "no_response") {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) throw new NotFoundException("Lead not found");
    // Keep the lifecycle status in sync with the legacy outcome endpoint.
    const statusFields = outcome === "won" ? statusUpdateFields(lead, "closed_won") : outcome === "lost" ? statusUpdateFields(lead, "closed_lost") : {};
    return this.prisma.client.lead.update({ where: { id: leadId }, data: { ...statusFields, ownerOutcome: outcome } });
  }

  // Hot/warm leads gone quiet 24h+ with no appointment or escalation follow-up — the ones worth a direct owner nudge.
  async getCoolingLeads(businessId: string) {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const leads = await this.prisma.client.lead.findMany({
      where: {
        businessId,
        scoreBand: { in: ["hot", "warm"] },
        status: { notIn: ["closed_won", "closed_lost"] },
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

    const latestConversation = await this.prisma.client.conversation.findFirst({
      where: { leadId: lead.id, businessId },
      orderBy: { lastMessageAt: "desc" },
    });
    let resolvedTopic: string | null = null;
    if (latestConversation) {
      const recentVisitorMessages = await this.prisma.client.message.findMany({
        where: { conversationId: latestConversation.id, role: "visitor" },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      resolvedTopic = resolveTopicFrom(null, recentVisitorMessages.map((msg) => String(msg.content ?? "")));
    }

    const message = buildOwnerOutreachMessage(lead.name ?? "", business.name, resolvedTopic ?? topic);
    const url = buildWaMeLink(lead.phone, message);

    await this.prisma.client.lead.update({ where: { id: lead.id }, data: { whatsappContactedAt: new Date() } });
    await this.advanceStatus(businessId, lead.id, "owner_contacted");
    return { url };
  }
}

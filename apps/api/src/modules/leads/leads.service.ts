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

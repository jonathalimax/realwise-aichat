import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboardSummary(businessId: string) {
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [conversations7d, leadsTotal, appointmentsTotal, linkOpenEvents] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since7d } } }),
      this.prisma.client.lead.count({ where: { businessId } }),
      this.prisma.client.appointment.count({ where: { businessId } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "link_opened", occurredAt: { gte: since7d } } }),
    ]);

    return { conversations7d, leadsTotal, appointmentsTotal, linkOpens7d: linkOpenEvents };
  }

  async topQuestions(businessId: string, limit = 10) {
    return this.prisma.client.unansweredQuestion.findMany({
      where: { businessId },
      orderBy: { occurrenceCount: "desc" },
      take: limit,
    });
  }

  async recordEvent(businessId: string, name: string, properties?: Record<string, unknown>, conversationId?: string, leadId?: string) {
    return this.prisma.client.analyticsEvent.create({
      data: { businessId, name, properties: properties as any, conversationId, leadId },
    });
  }
}

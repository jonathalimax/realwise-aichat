import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboardSummary(businessId: string) {
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const sevenDaysAgo = since7d;

    const [conversations7d, leadsTotal, appointmentsTotal, linkOpenEvents] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since7d } } }),
      this.prisma.client.lead.count({ where: { businessId } }),
      this.prisma.client.appointment.count({ where: { businessId } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "link_opened", occurredAt: { gte: since7d } } }),
    ]);

    // Prior comparable window for 7d metrics, and as-of-7-days-ago snapshot for lifetime totals.
    const [prevConversations7d, prevLeadsTotal, prevAppointmentsTotal, prevLinkOpenEvents] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since14d, lt: since7d } } }),
      this.prisma.client.lead.count({ where: { businessId, firstSeenAt: { lte: sevenDaysAgo } } }),
      // Appointment has no createdAt field; startsAt is the closest available timestamp for the snapshot.
      this.prisma.client.appointment.count({ where: { businessId, startsAt: { lte: sevenDaysAgo } } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "link_opened", occurredAt: { gte: since14d, lt: since7d } } }),
    ]);

    return {
      conversations7d,
      leadsTotal,
      appointmentsTotal,
      linkOpens7d: linkOpenEvents,
      previous: {
        conversations7d: prevConversations7d,
        leadsTotal: prevLeadsTotal,
        appointmentsTotal: prevAppointmentsTotal,
        linkOpens7d: prevLinkOpenEvents,
      },
    };
  }

  async timeseries(businessId: string, days = 14) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [conversations, leads, appointments, linkOpens] = await Promise.all([
      this.prisma.client.conversation.findMany({ where: { businessId, startedAt: { gte: since } }, select: { startedAt: true } }),
      this.prisma.client.lead.findMany({ where: { businessId, firstSeenAt: { gte: since } }, select: { firstSeenAt: true } }),
      this.prisma.client.appointment.findMany({ where: { businessId, createdVia: "chat", startsAt: { gte: since } }, select: { startsAt: true } }),
      this.prisma.client.analyticsEvent.findMany({ where: { businessId, name: "link_opened", occurredAt: { gte: since } }, select: { occurredAt: true } }),
    ]);

    const buckets = new Map<string, { date: string; conversations: number; leads: number; appointments: number; linkOpens: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      buckets.set(key, { date: key, conversations: 0, leads: 0, appointments: 0, linkOpens: 0 });
    }
    for (const c of conversations) {
      const bucket = buckets.get(c.startedAt.toISOString().slice(0, 10));
      if (bucket) bucket.conversations++;
    }
    for (const l of leads) {
      const bucket = buckets.get(l.firstSeenAt.toISOString().slice(0, 10));
      if (bucket) bucket.leads++;
    }
    for (const a of appointments) {
      const bucket = buckets.get(a.startsAt.toISOString().slice(0, 10));
      if (bucket) bucket.appointments++;
    }
    for (const e of linkOpens) {
      const bucket = buckets.get(e.occurredAt.toISOString().slice(0, 10));
      if (bucket) bucket.linkOpens++;
    }
    return Array.from(buckets.values());
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

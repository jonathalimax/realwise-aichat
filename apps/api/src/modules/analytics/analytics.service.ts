import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";

const WEEKDAY_LABELS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
  ) {}

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

  private async peakHour(businessId: string) {
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const conversations = await this.prisma.client.conversation.findMany({
      where: { businessId, startedAt: { gte: since30d } },
      select: { startedAt: true },
    });
    if (conversations.length === 0) return null;

    const buckets = new Map<string, number>();
    for (const c of conversations) {
      const weekday = WEEKDAY_LABELS[c.startedAt.getDay()];
      const hour = c.startedAt.getHours();
      const key = `${weekday}|${hour}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const [topKey, topCount] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
    const [weekday, hour] = topKey.split("|");
    const hourNum = Number(hour);
    const isOutsideBusinessHours = hourNum < 8 || hourNum >= 19;
    return { weekday, hourRange: `${hour}h–${hourNum + 1}h`, count: topCount, isOutsideBusinessHours };
  }

  private async conversionFunnel(businessId: string) {
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const [conversations, appointments, prevConversations, prevAppointments, escalated] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since7d } } }),
      this.prisma.client.appointment.count({ where: { businessId, createdVia: "chat", startsAt: { gte: since7d } } }),
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since14d, lt: since7d } } }),
      this.prisma.client.appointment.count({ where: { businessId, createdVia: "chat", startsAt: { gte: since14d, lt: since7d } } }),
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: since7d }, status: "escalated" } }),
    ]);
    if (conversations === 0) return null;
    const rate = appointments / conversations;
    const prevRate = prevConversations > 0 ? prevAppointments / prevConversations : null;
    return { conversations, appointments, rate, prevRate, escalated };
  }

  // Trial-without-subscription businesses see BASIC analytics only, same as the essencial plan —
  // "full" requires an active subscription whose plan.features explicitly marks it.
  private async hasFullAnalytics(businessId: string): Promise<boolean> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { subscription: { include: { plan: true } } },
    });
    const features = business?.subscription?.plan?.features as { analytics?: string } | undefined;
    return features?.analytics === "full";
  }

  private async responseTimePercentiles(businessId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const messages = await this.prisma.client.message.findMany({
      where: { businessId, role: "assistant", latencyMs: { not: null }, createdAt: { gte: since } },
      select: { latencyMs: true, createdAt: true },
      take: 5000,
    });
    if (messages.length === 0) return null;

    const sorted = [...messages].map((m) => m.latencyMs as number).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

    // Same date-bucketing idiom as timeseries() above.
    const buckets = new Map<string, number[]>();
    for (const m of messages) {
      const key = m.createdAt.toISOString().slice(0, 10);
      const list = buckets.get(key) ?? [];
      list.push(m.latencyMs as number);
      buckets.set(key, list);
    }
    const trend = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => {
        const s = [...values].sort((a, b) => a - b);
        return { date, medianMs: s[Math.floor(s.length / 2)] };
      });

    return {
      p50: percentile(50),
      p90: percentile(90),
      p99: percentile(99),
      trend,
    };
  }

  private async topListingsByInterest(businessId: string, days: number, limit = 5) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const messages = await this.prisma.client.message.findMany({
      where: { businessId, listingIds: { isEmpty: false }, createdAt: { gte: since } },
      select: { listingIds: true },
      take: 5000,
    });
    if (messages.length === 0) return [];

    const counts = new Map<string, number>();
    for (const m of messages) {
      for (const id of m.listingIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
    if (topIds.length === 0) return [];

    const listings = await this.prisma.client.listing.findMany({
      where: { id: { in: topIds }, businessId },
      select: { id: true, title: true, priceText: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return topIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({ ...l, mentions: counts.get(l.id) ?? 0 }));
  }

  private async leadQualityBreakdown(businessId: string) {
    const groups = await this.prisma.client.lead.groupBy({
      by: ["scoreBand"],
      where: { businessId },
      _count: true,
      _avg: { commitmentScore: true },
    });
    return groups.map((g) => ({
      scoreBand: g.scoreBand,
      count: g._count,
      avgCommitmentScore: g._avg.commitmentScore,
    }));
  }

  // Groups AnalyticsEvent rows for the "escalation" event by their `reason` property. Expected to
  // return empty/near-empty results until recordEvent calls wired into chat.service.ts/flow.service.ts
  // accumulate enough traffic — the chart is shipped now so it has real data going forward.
  private async escalationReasonBreakdown(businessId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const events = await this.prisma.client.analyticsEvent.findMany({
      where: { businessId, name: "escalation", occurredAt: { gte: since } },
      select: { properties: true },
    });
    const counts = new Map<string, number>();
    for (const e of events) {
      const reason = (e.properties as { reason?: string } | null)?.reason ?? "unknown";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
  }

  async getAdvancedAnalytics(businessId: string) {
    const full = await this.hasFullAnalytics(businessId);
    if (!full) return { locked: true };

    const [responseTime, topListings, leadQuality, funnel, escalationReasons] = await Promise.all([
      this.responseTimePercentiles(businessId, 30),
      this.topListingsByInterest(businessId, 30),
      this.leadQualityBreakdown(businessId),
      this.conversionFunnel(businessId),
      this.escalationReasonBreakdown(businessId, 30),
    ]);

    return { locked: false, responseTime, topListings, leadQuality, funnel, escalationReasons };
  }

  async canSeeFullAnalytics(businessId: string): Promise<boolean> {
    return this.hasFullAnalytics(businessId);
  }

  async getInsights(businessId: string) {
    const [cooling, topQuestions, peak, funnel] = await Promise.all([
      this.leadsService.getCoolingLeads(businessId),
      this.topQuestions(businessId, 1),
      this.peakHour(businessId),
      this.conversionFunnel(businessId),
    ]);

    return {
      coolingLeads: cooling,
      topUnansweredQuestion: topQuestions[0] ?? null,
      peakHour: peak,
      conversionFunnel: funnel,
    };
  }
}

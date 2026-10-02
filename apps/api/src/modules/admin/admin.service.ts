import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants() {
    return this.prisma.client.business.findMany({
      orderBy: { createdAt: "desc" },
      include: { subscription: { include: { plan: true } } },
    });
  }

  async tenantDetail(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { profile: true, subscription: { include: { plan: true } } },
    });
    if (!business) throw new NotFoundException("Tenant not found");
    return business;
  }

  async overrideConfidenceThreshold(businessId: string, _threshold: number) {
    // Threshold override stored on a per-business config in a future admin-config table.
    return this.prisma.client.business.findUnique({ where: { id: businessId } });
  }

  async suspendTenant(businessId: string) {
    return this.prisma.client.business.update({ where: { id: businessId }, data: { status: "suspended" } });
  }

  async bulkSuspendTenants(ids: string[]) {
    const existing = await this.prisma.client.business.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const suspendedIds = existing.map((b) => b.id);
    const notFoundIds = ids.filter((id) => !suspendedIds.includes(id));
    if (suspendedIds.length > 0) {
      await this.prisma.client.business.updateMany({ where: { id: { in: suspendedIds } }, data: { status: "suspended" } });
    }
    return { suspendedIds, notFoundIds };
  }

  async globalMetrics() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [tenantCount, liveTenantCount, conversationCount, leadCount] = await Promise.all([
      this.prisma.client.business.count(),
      this.prisma.client.business.count({ where: { status: "live" } }),
      this.prisma.client.conversation.count(),
      this.prisma.client.lead.count(),
    ]);

    // Snapshot counts as-of-7-days-ago give trend badges a real comparable baseline for lifetime totals.
    const [prevTenantCount, prevLiveTenantCount, prevConversationCount, prevLeadCount] = await Promise.all([
      this.prisma.client.business.count({ where: { createdAt: { lte: sevenDaysAgo } } }),
      this.prisma.client.business.count({ where: { status: "live", createdAt: { lte: sevenDaysAgo } } }),
      this.prisma.client.conversation.count({ where: { startedAt: { lte: sevenDaysAgo } } }),
      this.prisma.client.lead.count({ where: { firstSeenAt: { lte: sevenDaysAgo } } }),
    ]);

    return {
      tenantCount,
      liveTenantCount,
      conversationCount,
      leadCount,
      previous: {
        tenantCount: prevTenantCount,
        liveTenantCount: prevLiveTenantCount,
        conversationCount: prevConversationCount,
        leadCount: prevLeadCount,
      },
    };
  }

  async metricsTimeseries(days = 14) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [conversations, llmCalls] = await Promise.all([
      this.prisma.client.conversation.findMany({
        where: { startedAt: { gte: since } },
        select: { startedAt: true },
      }),
      this.prisma.client.llmCallLog.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, inputTokens: true, outputTokens: true },
      }),
    ]);

    const buckets = new Map<string, { date: string; conversations: number; tokens: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, conversations: 0, tokens: 0 });
    }
    for (const c of conversations) {
      const key = c.startedAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.conversations++;
    }
    for (const call of llmCalls) {
      const key = call.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.tokens += call.inputTokens + call.outputTokens;
    }
    return Array.from(buckets.values());
  }

  async confidenceDistribution() {
    const businesses = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { confidenceScore: true },
    });
    const buckets = [
      { range: "0-29", count: 0 },
      { range: "30-49", count: 0 },
      { range: "50-69", count: 0 },
      { range: "70-89", count: 0 },
      { range: "90-100", count: 0 },
    ];
    for (const b of businesses) {
      const s = b.confidenceScore;
      if (s < 30) buckets[0].count++;
      else if (s < 50) buckets[1].count++;
      else if (s < 70) buckets[2].count++;
      else if (s < 90) buckets[3].count++;
      else buckets[4].count++;
    }
    return buckets;
  }
}

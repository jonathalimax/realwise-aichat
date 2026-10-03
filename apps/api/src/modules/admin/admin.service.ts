import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { estimateCostUsd } from "./model-pricing";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // Grouped by businessId so callers can attach per-tenant tokens/cost without an N+1 query per tenant.
  private async usageByBusinessLast7d(): Promise<Map<string, { tokens: number; costUsd: number }>> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const calls = await this.prisma.client.llmCallLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, businessId: { not: null } },
      select: { businessId: true, provider: true, model: true, inputTokens: true, outputTokens: true },
    });
    const usage = new Map<string, { tokens: number; costUsd: number }>();
    for (const call of calls) {
      if (!call.businessId) continue;
      const entry = usage.get(call.businessId) ?? { tokens: 0, costUsd: 0 };
      entry.tokens += call.inputTokens + call.outputTokens;
      entry.costUsd += estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens);
      usage.set(call.businessId, entry);
    }
    return usage;
  }

  async listTenants() {
    const [tenants, usage] = await Promise.all([
      this.prisma.client.business.findMany({
        orderBy: { createdAt: "desc" },
        include: { subscription: { include: { plan: true } } },
      }),
      this.usageByBusinessLast7d(),
    ]);
    return tenants.map((t) => ({
      ...t,
      tokensUsed7d: usage.get(t.id)?.tokens ?? 0,
      costUsd7d: usage.get(t.id)?.costUsd ?? 0,
    }));
  }

  async tenantDetail(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { profile: true, subscription: { include: { plan: true } } },
    });
    if (!business) throw new NotFoundException("Tenant not found");
    const usage = await this.usageByBusinessLast7d();
    return { ...business, tokensUsed7d: usage.get(businessId)?.tokens ?? 0, costUsd7d: usage.get(businessId)?.costUsd ?? 0 };
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

    const [tenantCount, liveTenantCount, conversationCount, leadCount, recentLlmCalls] = await Promise.all([
      this.prisma.client.business.count(),
      this.prisma.client.business.count({ where: { status: "live" } }),
      this.prisma.client.conversation.count(),
      this.prisma.client.lead.count(),
      this.prisma.client.llmCallLog.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { provider: true, model: true, inputTokens: true, outputTokens: true },
      }),
    ]);

    const totalCostUsd7d = recentLlmCalls.reduce(
      (sum, call) => sum + estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens),
      0,
    );

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
      totalCostUsd7d,
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
        select: { createdAt: true, inputTokens: true, outputTokens: true, provider: true, model: true },
      }),
    ]);

    const buckets = new Map<string, { date: string; conversations: number; tokens: number; costUsd: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, conversations: 0, tokens: 0, costUsd: 0 });
    }
    for (const c of conversations) {
      const key = c.startedAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.conversations++;
    }
    for (const call of llmCalls) {
      const key = call.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.tokens += call.inputTokens + call.outputTokens;
        bucket.costUsd += estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens);
      }
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

  async getPlatformConfig() {
    return this.prisma.client.platformConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });
  }

  async updatePlatformConfig(supportWhatsappNumber: string) {
    const digits = (supportWhatsappNumber ?? "").replace(/\D/g, "");
    if (digits.length > 0 && digits.length < 10) {
      throw new BadRequestException("Número inválido — use apenas dígitos (DDD + número).");
    }
    const value = digits.length > 0 ? digits : null;
    return this.prisma.client.platformConfig.upsert({
      where: { id: "singleton" },
      update: { supportWhatsappNumber: value },
      create: { id: "singleton", supportWhatsappNumber: value },
    });
  }
}

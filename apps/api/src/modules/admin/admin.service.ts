import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates, questionForField } from "@realwise/profile-schema";
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

  async tenantKnowledge(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { niche: true },
    });
    if (!business) throw new NotFoundException("Tenant not found");

    const [profile, documents, markdownLengths, chunkTotal, listingCount, chunkSample] = await Promise.all([
      this.prisma.client.businessProfile.findUnique({ where: { businessId } }),
      this.prisma.client.knowledgeDocument.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          source: true,
          status: true,
          ocrUsed: true,
          pageCount: true,
          processingError: true,
          createdAt: true,
          retentionDeleteAt: true,
          _count: { select: { chunks: true, listings: true } },
        },
      }),
      this.prisma.client.knowledgeDocument.findMany({
        where: { businessId },
        select: { id: true, extractedMarkdown: true },
      }),
      this.prisma.client.knowledgeChunk.count({ where: { businessId } }),
      this.prisma.client.listing.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.knowledgeChunk.findMany({
        where: { businessId },
        orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
        take: 5,
        select: { id: true, documentId: true, ordinal: true, tokenCount: true, sectionPath: true, content: true },
      }),
    ]);

    const markdownLengthById = new Map(markdownLengths.map((d) => [d.id, d.extractedMarkdown?.length ?? 0]));

    const documentsWithMeta = documents.map((doc) => {
      const { _count, ...rest } = doc;
      return {
        ...rest,
        markdownLength: markdownLengthById.get(doc.id) ?? 0,
        chunkCount: _count.chunks,
        listingCount: _count.listings,
      };
    });

    const chunkSampleTrimmed = chunkSample.map((c) => ({
      ...c,
      content: c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content,
    }));

    const template = nicheTemplates[business.niche];
    const templateFields = template?.fields ?? [];
    const data = (profile?.data as Record<string, unknown>) ?? {};
    const fieldStatus = (profile?.fieldStatus as Record<string, any>) ?? {};

    const fields = templateFields.map((field) => ({
      key: field.key,
      label: field.label,
      weight: field.weight,
      question: template ? questionForField(template, field.key) : undefined,
      value: data[field.key] ?? null,
      source: fieldStatus[field.key]?.source ?? null,
      approvedByOwner: fieldStatus[field.key]?.approvedByOwner ?? false,
      updatedAt: fieldStatus[field.key]?.updatedAt ?? null,
    }));

    const templateKeys = new Set(templateFields.map((f) => f.key));
    const orphanData = Object.fromEntries(Object.entries(data).filter(([key]) => !templateKeys.has(key)));

    return {
      profile: profile
        ? {
            templateVersion: profile.templateVersion,
            cachedSummary: profile.cachedSummary,
            cachedSummaryTokens: profile.cachedSummaryTokens,
            customInstructions: profile.customInstructions,
            approvedAt: profile.approvedAt,
            updatedAt: profile.updatedAt,
            fields,
            orphanData,
          }
        : null,
      documents: documentsWithMeta,
      chunkTotal,
      chunkSample: chunkSampleTrimmed,
      listingCount,
    };
  }

  async tenantDocumentMarkdown(businessId: string, documentId: string) {
    const document = await this.prisma.client.knowledgeDocument.findFirst({
      where: { id: documentId, businessId },
      select: { id: true, filename: true, extractedMarkdown: true },
    });
    if (!document) throw new NotFoundException("Document not found");
    return document;
  }

  async tenantListings(businessId: string, limit = 50, offset = 0) {
    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    const clampedOffset = Math.max(offset, 0);

    const [listings, total, deletedCount] = await Promise.all([
      this.prisma.client.listing.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: clampedLimit,
        skip: clampedOffset,
        include: { _count: { select: { images: true } } },
      }),
      this.prisma.client.listing.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.listing.count({ where: { businessId, deletedAt: { not: null } } }),
    ]);

    return { listings, total, deletedCount };
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

  // Splits "listing_extraction" (background scraper pipeline) from "extraction" (legacy +
  // chat-path calls) so admin cost monitoring can isolate background scraper spend from the
  // visitor-facing chat path that shares the same model/pricing machinery.
  async extractionCostMetrics(days = 14) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const calls = await this.prisma.client.llmCallLog.findMany({
      where: { createdAt: { gte: since }, purpose: { in: ["listing_extraction", "extraction"] } },
      select: {
        purpose: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        latencyMs: true,
        error: true,
        createdAt: true,
      },
    });

    type Group = {
      calls: number;
      failedCalls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      avgLatencyMs: number;
    };
    const makeGroup = (): Group & { latencySum: number; latencyCount: number } => ({
      calls: 0,
      failedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      latencySum: 0,
      latencyCount: 0,
    });
    const pipeline = makeGroup();
    const chatPath = makeGroup();

    for (const call of calls) {
      const group = call.purpose === "listing_extraction" ? pipeline : chatPath;
      group.calls++;
      group.inputTokens += call.inputTokens;
      group.outputTokens += call.outputTokens;
      group.totalTokens += call.inputTokens + call.outputTokens;
      if (call.error !== null) {
        group.failedCalls++;
        continue;
      }
      group.costUsd += estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens);
      if (typeof call.latencyMs === "number") {
        group.latencySum += call.latencyMs;
        group.latencyCount++;
      }
    }

    const finalize = ({ latencySum, latencyCount, ...rest }: ReturnType<typeof makeGroup>): Group => ({
      ...rest,
      avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
    });

    const pipelineResult = finalize(pipeline);
    const chatPathResult = finalize(chatPath);

    return {
      days,
      pipeline: pipelineResult,
      chatPath: chatPathResult,
      totalCostUsd: pipelineResult.costUsd + chatPathResult.costUsd,
      totalTokens: pipelineResult.totalTokens + chatPathResult.totalTokens,
    };
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

  // Conversation-level debug/observability data: how many assistant replies abstained vs
  // answered vs escalated, response-time distribution, and the same breakdown per tenant — so a
  // slow or silent Clara can be spotted from the admin UI instead of only by someone reporting it.
  async conversationInsights(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const messages = await this.prisma.client.message.findMany({
      where: { role: "assistant", createdAt: { gte: since } },
      select: { businessId: true, answerSource: true, latencyMs: true, feedback: true, flagged: true, createdAt: true },
    });

    const bySource = { fixed_flow: 0, rag: 0, abstained: 0, escalation: 0, none: 0 };
    const latencies: number[] = [];
    const perBusiness = new Map<
      string,
      { total: number; abstained: number; escalated: number; flagged: number; negativeFeedback: number; latencies: number[] }
    >();

    for (const m of messages) {
      bySource[m.answerSource ?? "none"] = (bySource[m.answerSource ?? "none"] ?? 0) + 1;
      if (typeof m.latencyMs === "number" && m.latencyMs > 0) latencies.push(m.latencyMs);

      const entry = perBusiness.get(m.businessId) ?? {
        total: 0,
        abstained: 0,
        escalated: 0,
        flagged: 0,
        negativeFeedback: 0,
        latencies: [] as number[],
      };
      entry.total++;
      if (m.answerSource === "abstained") entry.abstained++;
      if (m.answerSource === "escalation") entry.escalated++;
      if (m.flagged) entry.flagged++;
      if (m.feedback === "negative") entry.negativeFeedback++;
      if (typeof m.latencyMs === "number" && m.latencyMs > 0) entry.latencies.push(m.latencyMs);
      perBusiness.set(m.businessId, entry);
    }

    const median = (arr: number[]) => {
      if (arr.length === 0) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    };
    const avg = (arr: number[]) => (arr.length === 0 ? null : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));

    const businessIds = [...perBusiness.keys()];
    const businesses = businessIds.length
      ? await this.prisma.client.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(businesses.map((b) => [b.id, b.name]));

    // Same LlmCallLog-based estimate used elsewhere in this service, scoped to this same window
    // so the cost column lines up with the conversation stats shown alongside it, not a fixed 7d.
    const costByBusiness = new Map<string, number>();
    if (businessIds.length) {
      const calls = await this.prisma.client.llmCallLog.findMany({
        where: { createdAt: { gte: since }, businessId: { in: businessIds } },
        select: { businessId: true, provider: true, model: true, inputTokens: true, outputTokens: true },
      });
      for (const call of calls) {
        if (!call.businessId) continue;
        const prev = costByBusiness.get(call.businessId) ?? 0;
        costByBusiness.set(call.businessId, prev + estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens));
      }
    }

    return {
      totalMessages: messages.length,
      bySource,
      abstentionRate: messages.length ? bySource.abstained / messages.length : 0,
      escalationRate: messages.length ? bySource.escalation / messages.length : 0,
      medianLatencyMs: median(latencies),
      avgLatencyMs: avg(latencies),
      perBusiness: [...perBusiness.entries()]
        .map(([businessId, e]) => ({
          businessId,
          businessName: nameById.get(businessId) ?? "—",
          total: e.total,
          abstained: e.abstained,
          escalated: e.escalated,
          flagged: e.flagged,
          negativeFeedback: e.negativeFeedback,
          medianLatencyMs: median(e.latencies),
          costUsd: costByBusiness.get(businessId) ?? 0,
        }))
        .sort((a, b) => b.total - a.total),
    };
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

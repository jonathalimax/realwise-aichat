import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates, questionForField } from "@realwise/profile-schema";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { estimateCostUsd, getEntryPlan } from "@realwise/shared";
import { ListingsService, type ListingItem } from "../listings/listings.service";
import { getPersona } from "../chat/personas";

// Mirrors the resolution order in apps/inference-gateway/src/budget.ts (Business override -> Plan
// threshold -> this default). The default (business with no subscription) is the entry plan's
// budget from the shared plan catalog, same as the gateway's.
const DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS = getEntryPlan().llmMonthlyBudgetUsdCents;
const MANAGED_MODEL = process.env.MANAGED_MODEL ?? "qwen/qwen-2.5-7b-instruct";
const MANAGED_MODEL_CHAT = process.env.MANAGED_MODEL_CHAT ?? "z-ai/glm-4.7-flash";

// Same local-midnight-in-tenant-timezone math as apps/inference-gateway/src/budget.ts's
// monthStartUtcForTimezone — duplicated here for the same cross-deployable reason as the default
// budget constant above.
function monthStartUtcForTimezone(tz: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const hour = Number(get("hour")) % 24;
  const localAsUtc = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const localNowAsUtc = Date.UTC(year, month - 1, Number(get("day")), hour, Number(get("minute")), Number(get("second")));
  const offsetMs = localNowAsUtc - now.getTime();
  return new Date(localAsUtc - offsetMs);
}

// Mirrors ABSTENTION_FALLBACK/NO_CONTEXT_FALLBACK in chat.service.ts. Duplicated locally rather
// than imported across modules so admin stays independent of the chat module's internals — if
// those fallback copies ever change, this categorization heuristic needs updating too.
const ABSTENTION_FALLBACK = "Essa eu não tenho aqui. Quer que eu te passe pro atendimento?";
const NO_CONTEXT_FALLBACK = "Não encontrei essa informação na nossa base. Quer que eu te passe pro atendimento?";

export const PROBLEM_CASE_CATEGORIES = [
  "no_context",
  "grounding_guard",
  "gateway_error",
  "model_abstained",
  "escalated",
  "flagged",
  "negative_feedback",
] as const;
export type ProblemCaseCategory = (typeof PROBLEM_CASE_CATEGORIES)[number];

type ProblemCaseMessageShape = {
  answerSource: string | null;
  retrievedChunkIds: string[];
  retrievalTopScore: number | null;
  modelUsed: string | null;
  inputTokens: number | null;
  content: string;
  flagged: boolean;
  feedback: string | null;
};

// Categorizes an assistant message by field-shape inference — there is no stored "reason" column,
// so we distinguish "silent" failure modes from the combination of answerSource plus a few
// telltale fields (no retrieved context, no model used, or the exact fallback string).
function categorizeProblemMessage(m: ProblemCaseMessageShape): ProblemCaseCategory {
  if (m.answerSource === "escalation") return "escalated";
  if (m.answerSource === "abstained") {
    if (m.retrievedChunkIds.length === 0 && m.retrievalTopScore == null) return "no_context";
    if (!m.modelUsed || m.modelUsed === "unknown" || !m.inputTokens) return "gateway_error";
    if (m.content.trim() === ABSTENTION_FALLBACK) return "grounding_guard";
    return "model_abstained";
  }
  if (m.flagged) return "flagged";
  if (m.feedback === "negative") return "negative_feedback";
  return "model_abstained"; // fallback, shouldn't hit given the where clause
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingsService: ListingsService,
  ) {}

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

    // Batched month-to-date spend lookup for the "Modelo ativo" column — one query covering every
    // tenant's local calendar month (using the earliest possible month-start across all timezones),
    // then grouped/filtered per tenant in memory by each tenant's own local month-start.
    const now = new Date();
    const lookbackStart = (() => {
      const d = new Date(now);
      d.setUTCDate(1);
      d.setUTCDate(d.getUTCDate() - 1); // 1 day of slack for timezones ahead of UTC
      return d;
    })();
    const calls = await this.prisma.client.llmCallLog.findMany({
      where: { createdAt: { gte: lookbackStart }, businessId: { not: null } },
      select: { businessId: true, provider: true, model: true, inputTokens: true, outputTokens: true, createdAt: true },
    });
    const callsByBusiness = new Map<string, typeof calls>();
    for (const call of calls) {
      if (!call.businessId) continue;
      const arr = callsByBusiness.get(call.businessId) ?? [];
      arr.push(call);
      callsByBusiness.set(call.businessId, arr);
    }

    return tenants.map((t) => {
      const threshold =
        t.llmMonthlyBudgetUsdCents ?? t.subscription?.plan?.llmMonthlyBudgetUsdCents ?? DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS;
      const monthStart = monthStartUtcForTimezone(t.timezone, now);
      const monthCalls = (callsByBusiness.get(t.id) ?? []).filter((c) => c.createdAt >= monthStart);
      const monthToDateUsdCents = monthCalls.reduce(
        (sum, c) => sum + estimateCostUsd(c.provider, c.model, c.inputTokens, c.outputTokens) * 100,
        0,
      );
      const activeChatModel = monthToDateUsdCents >= threshold ? MANAGED_MODEL : MANAGED_MODEL_CHAT;
      return {
        ...t,
        tokensUsed7d: usage.get(t.id)?.tokens ?? 0,
        costUsd7d: usage.get(t.id)?.costUsd ?? 0,
        activeChatModel,
      };
    });
  }

  async tenantDetail(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { profile: true, subscription: { include: { plan: true } } },
    });
    if (!business) throw new NotFoundException("Tenant not found");
    const [usage, llmBudget] = await Promise.all([this.usageByBusinessLast7d(), this.llmBudgetStatus(businessId)]);
    return {
      ...business,
      tokensUsed7d: usage.get(businessId)?.tokens ?? 0,
      costUsd7d: usage.get(businessId)?.costUsd ?? 0,
      llmBudget,
    };
  }

  // Resolution order mirrors apps/inference-gateway/src/budget.ts: Business override -> Plan
  // threshold -> DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS. Read-only reporting for the admin UI — the
  // gateway's own in-memory cache is the source of truth for the live downgrade decision.
  async llmBudgetStatus(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        timezone: true,
        llmMonthlyBudgetUsdCents: true,
        subscription: { select: { plan: { select: { code: true, llmMonthlyBudgetUsdCents: true } } } },
      },
    });
    if (!business) throw new NotFoundException("Tenant not found");

    const tier = business.subscription?.plan?.code ?? "essencial";
    const planThreshold = business.subscription?.plan?.llmMonthlyBudgetUsdCents;
    const source: "override" | "plan" | "default" =
      business.llmMonthlyBudgetUsdCents != null ? "override" : planThreshold != null ? "plan" : "default";
    const thresholdUsdCents = business.llmMonthlyBudgetUsdCents ?? planThreshold ?? DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS;

    const now = new Date();
    const monthStartsAt = monthStartUtcForTimezone(business.timezone, now);
    const calls = await this.prisma.client.llmCallLog.findMany({
      where: { businessId, createdAt: { gte: monthStartsAt } },
      select: { provider: true, model: true, inputTokens: true, outputTokens: true },
    });
    const monthToDateUsd = calls.reduce(
      (sum, c) => sum + estimateCostUsd(c.provider, c.model, c.inputTokens, c.outputTokens),
      0,
    );
    const activeChatModel = monthToDateUsd * 100 >= thresholdUsdCents ? MANAGED_MODEL : MANAGED_MODEL_CHAT;

    return { tier, thresholdUsdCents, source, monthToDateUsd, activeChatModel, monthStartsAt };
  }

  async setLlmBudgetOverride(businessId: string, llmMonthlyBudgetUsdCents: number | null) {
    if (llmMonthlyBudgetUsdCents !== null) {
      if (!Number.isFinite(llmMonthlyBudgetUsdCents) || llmMonthlyBudgetUsdCents < 0 || llmMonthlyBudgetUsdCents > 100000) {
        throw new BadRequestException("llmMonthlyBudgetUsdCents must be between 0 and 100000, or null to clear the override");
      }
    }
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Tenant not found");
    return this.prisma.client.business.update({
      where: { id: businessId },
      data: { llmMonthlyBudgetUsdCents },
    });
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

  // Lightweight list for the tenant detail page's "Conversas" tab — mirrors InboxService's own
  // listConversations shape (id, timestamps, status, referenceCode, message count) rather than
  // inventing a different one, since this is the same underlying Conversation table.
  async tenantConversations(businessId: string, limit = 50, offset = 0) {
    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    const clampedOffset = Math.max(offset, 0);

    const [conversations, total] = await Promise.all([
      this.prisma.client.conversation.findMany({
        where: { businessId },
        orderBy: { lastMessageAt: "desc" },
        take: clampedLimit,
        skip: clampedOffset,
        include: { lead: { select: { id: true, name: true, phone: true } } },
      }),
      this.prisma.client.conversation.count({ where: { businessId } }),
    ]);

    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        status: c.status,
        startedAt: c.startedAt,
        lastMessageAt: c.lastMessageAt,
        escalatedAt: c.escalatedAt,
        referenceCode: c.referenceCode,
        messageCount: c.messageCount,
        lead: c.lead,
      })),
      total,
    };
  }

  // Full-fidelity replay for a single conversation, exactly mirroring ChatService.getHistory's
  // listing rehydration (resolve Message.listingIds against the live Listing table in one batched
  // lookup) so the admin "mirror" view reflects what the visitor actually saw — the same
  // listingIds-based re-hydration InboxService.getThread now also uses for the dashboard inbox.
  async tenantConversationThread(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      include: { business: { select: { niche: true, name: true } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const messages = await this.prisma.client.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    const allListingIds = [...new Set(messages.flatMap((m) => m.listingIds))];
    const listingsById = new Map(
      allListingIds.length > 0
        ? (await this.listingsService.findByIdsForChat(businessId, allListingIds)).map((l) => [l.id as string, l])
        : [],
    );
    const messagesWithListings = messages.map((m) => {
      if (m.listingIds.length === 0) return m;
      const listings = m.listingIds.map((id) => listingsById.get(id)).filter((l): l is ListingItem => Boolean(l));
      return listings.length > 0 ? { ...m, listings } : m;
    });

    return {
      id: conversation.id,
      status: conversation.status,
      referenceCode: conversation.referenceCode,
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      personaName: getPersona(conversation.business.niche).name,
      niche: conversation.business.niche,
      businessName: conversation.business.name,
      messages: messagesWithListings,
    };
  }

  async overrideConfidenceThreshold(businessId: string, _threshold: number) {
    // Threshold override stored on a per-business config in a future admin-config table.
    return this.prisma.client.business.findUnique({ where: { id: businessId } });
  }

  // Stage 5 conversational redesign — admin-only toggle (never exposed via the tenant-facing
  // PATCH /businesses/me). Mirrors overrideConfidenceThreshold's admin-only pattern above.
  async setConversationalMode(businessId: string, enabled: boolean) {
    if (typeof enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean");
    }
    return this.prisma.client.business.update({ where: { id: businessId }, data: { conversationalModeEnabled: enabled } });
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

  // Real conversation-answering spend, as distinct from extractionCostMetrics' pipeline/chatPath
  // split above. Only purpose="chat" is included — chat.service.ts never actually emits "chips" or
  // "summary" LlmCallLog rows today (those purposes exist in gateway-client.ts's type union but are
  // unused call sites as of this writing), so including them would be speculative, not real cost.
  //
  // Grain: LlmCallLog has no conversationId (only businessId) and no other model links a call back
  // to a specific Conversation row, so true per-conversation cost isn't trackable with the current
  // schema. This aggregates at business+day grain instead, which still supports filtering by client,
  // filtering/ranging by date, and sorting — a future migration adding conversationId to LlmCallLog
  // would be needed for true per-conversation rows.
  async conversationCostMetrics(params: {
    businessId?: string;
    from?: Date;
    to?: Date;
    sortBy?: "cost" | "date" | "tokens";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }) {
    const { businessId, from, to } = params;
    const sortBy = params.sortBy ?? "date";
    const sortOrder = params.sortOrder ?? "desc";
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);

    const calls = await this.prisma.client.llmCallLog.findMany({
      where: {
        purpose: "chat",
        ...(businessId ? { businessId } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: {
        businessId: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        error: true,
        createdAt: true,
      },
    });

    type Group = { businessId: string; date: string; costUsd: number; tokens: number; calls: number; failedCalls: number };
    const groups = new Map<string, Group>();
    let totalCostUsd = 0;
    let totalTokens = 0;
    let totalCalls = 0;

    for (const call of calls) {
      if (!call.businessId) continue;
      const date = call.createdAt.toISOString().slice(0, 10);
      const key = `${call.businessId}:${date}`;
      const group = groups.get(key) ?? { businessId: call.businessId, date, costUsd: 0, tokens: 0, calls: 0, failedCalls: 0 };
      group.calls++;
      totalCalls++;
      const tokens = call.inputTokens + call.outputTokens;
      group.tokens += tokens;
      totalTokens += tokens;
      if (call.error !== null) {
        group.failedCalls++;
      } else {
        const cost = estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens);
        group.costUsd += cost;
        totalCostUsd += cost;
      }
      groups.set(key, group);
    }

    const businessIds = [...new Set([...groups.values()].map((g) => g.businessId))];
    const businesses = businessIds.length
      ? await this.prisma.client.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(businesses.map((b) => [b.id, b.name]));

    const rows = [...groups.values()].map((g) => ({
      businessId: g.businessId,
      businessName: nameById.get(g.businessId) ?? "—",
      date: g.date,
      costUsd: g.costUsd,
      tokens: g.tokens,
      calls: g.calls,
      failedCalls: g.failedCalls,
    }));

    const sorted = rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "cost") cmp = a.costUsd - b.costUsd;
      else if (sortBy === "tokens") cmp = a.tokens - b.tokens;
      else cmp = a.date.localeCompare(b.date);
      return sortOrder === "asc" ? cmp : -cmp;
    });

    const total = sorted.length;
    const page = sorted.slice(offset, offset + limit);

    return {
      totalCostUsd,
      totalTokens,
      totalCalls,
      total,
      limit,
      offset,
      rows: page,
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

    const bySource = { fixed_flow: 0, rag: 0, abstained: 0, escalation: 0, discovery: 0, none: 0 };
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

  // Drill-down behind the "Silêncio"/"Escalado"/"Sinalizado" counts in conversationInsights: the
  // actual problem cases (question/answer/category) instead of just a count, since there's no
  // stored "reason" column — categoryWhere below mirrors categorizeProblemMessage's own logic.
  async conversationProblemCases(params: { days: number; businessId?: string; category?: string; limit: number; offset: number }) {
    const { days, businessId, category } = params;
    const limit = Math.min(Math.max(params.limit, 1), 100);
    const offset = Math.max(params.offset, 0);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const categoryWhere = (() => {
      switch (category) {
        case "no_context":
          return { answerSource: "abstained" as const, retrievedChunkIds: { isEmpty: true }, retrievalTopScore: null };
        case "grounding_guard":
          return { answerSource: "abstained" as const, content: ABSTENTION_FALLBACK };
        case "gateway_error":
          return { answerSource: "abstained" as const };
        case "model_abstained":
          return { answerSource: "abstained" as const };
        case "escalated":
          return { answerSource: "escalation" as const };
        case "flagged":
          return { flagged: true };
        case "negative_feedback":
          return { feedback: "negative" };
        default:
          return undefined;
      }
    })();

    const where = {
      role: "assistant",
      createdAt: { gte: since },
      ...(businessId ? { businessId } : {}),
      ...(categoryWhere ?? {
        OR: [
          { answerSource: { in: ["abstained" as const, "escalation" as const] } },
          { flagged: true },
          { feedback: "negative" },
        ],
      }),
      // Cast needed because categoryWhere's union of narrow literal shapes doesn't line up with
      // Prisma's generated WhereInput type without importing @prisma/client's Prisma namespace
      // into this module (not currently a direct dependency here — @realwise/db owns that).
    } as any;

    const rows = await this.prisma.client.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      skip: offset,
      select: {
        id: true,
        conversationId: true,
        businessId: true,
        content: true,
        createdAt: true,
        answerSource: true,
        retrievedChunkIds: true,
        retrievalTopScore: true,
        modelUsed: true,
        inputTokens: true,
        latencyMs: true,
        flagged: true,
        feedback: true,
      },
    });

    const hasMore = rows.length > limit;
    const cases = rows.slice(0, limit);

    // Some categories (gateway_error, model_abstained, no explicit category filter) select
    // multiple answerSource="abstained" shapes server-side; refine to the exact category client
    // of this method expects by re-running the same inference used for the overview counts.
    const filtered = category
      ? cases.filter((m) => categorizeProblemMessage(m) === category)
      : cases;

    const conversationIds = [...new Set(filtered.map((m) => m.conversationId))];
    const maxCreatedAt = filtered.reduce<Date | null>(
      (max, m) => (max === null || m.createdAt > max ? m.createdAt : max),
      null,
    );

    const visitorMessages = conversationIds.length
      ? await this.prisma.client.message.findMany({
          where: {
            conversationId: { in: conversationIds },
            role: "visitor",
            ...(maxCreatedAt ? { createdAt: { lte: maxCreatedAt } } : {}),
          },
          select: { conversationId: true, content: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [];

    const visitorByConversation = new Map<string, { content: string; createdAt: Date }[]>();
    for (const vm of visitorMessages) {
      const list = visitorByConversation.get(vm.conversationId) ?? [];
      list.push({ content: vm.content, createdAt: vm.createdAt });
      visitorByConversation.set(vm.conversationId, list);
    }
    const nearestQuestion = (conversationId: string, before: Date): string | null => {
      const list = visitorByConversation.get(conversationId);
      if (!list) return null;
      const candidate = list.find((vm) => vm.createdAt <= before);
      return candidate?.content ?? null;
    };

    const businessIds = [...new Set(filtered.map((m) => m.businessId))];
    const businesses = businessIds.length
      ? await this.prisma.client.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(businesses.map((b) => [b.id, b.name]));

    // Best-effort proximity match: LlmCallLog has no foreign key to Message, so we pair a
    // gateway_error case to the nearest-in-time failed "chat" purpose call for the same
    // business, within a loose +/-60s window — approximate, not a guaranteed correlation.
    const gatewayErrorCases = filtered.filter((m) => categorizeProblemMessage(m) === "gateway_error");
    const gatewayErrorByBusiness = new Map<string, { createdAt: Date; error: string }[]>();
    if (gatewayErrorCases.length) {
      const minCreatedAt = new Date(Math.min(...gatewayErrorCases.map((m) => m.createdAt.getTime())) - 60_000);
      const maxCreatedAtWindow = new Date(Math.max(...gatewayErrorCases.map((m) => m.createdAt.getTime())) + 60_000);
      const logs = await this.prisma.client.llmCallLog.findMany({
        where: {
          purpose: "chat",
          error: { not: null },
          businessId: { in: [...new Set(gatewayErrorCases.map((m) => m.businessId))] },
          createdAt: { gte: minCreatedAt, lte: maxCreatedAtWindow },
        },
        select: { businessId: true, createdAt: true, error: true },
      });
      for (const log of logs) {
        if (!log.businessId || !log.error) continue;
        const list = gatewayErrorByBusiness.get(log.businessId) ?? [];
        list.push({ createdAt: log.createdAt, error: log.error });
        gatewayErrorByBusiness.set(log.businessId, list);
      }
    }
    const nearestGatewayError = (businessId: string, at: Date): string | undefined => {
      const list = gatewayErrorByBusiness.get(businessId);
      if (!list || list.length === 0) return undefined;
      let nearest = list[0];
      let nearestDiff = Math.abs(nearest.createdAt.getTime() - at.getTime());
      for (const entry of list) {
        const diff = Math.abs(entry.createdAt.getTime() - at.getTime());
        if (diff < nearestDiff) {
          nearest = entry;
          nearestDiff = diff;
        }
      }
      return nearest.error.length > 300 ? `${nearest.error.slice(0, 300)}…` : nearest.error;
    };

    const truncate = (text: string) => (text.length > 600 ? `${text.slice(0, 600)}…` : text);

    const items = filtered.map((m) => {
      const resolvedCategory = categorizeProblemMessage(m);
      const questionRaw = nearestQuestion(m.conversationId, m.createdAt);
      return {
        messageId: m.id,
        conversationId: m.conversationId,
        businessId: m.businessId,
        businessName: nameById.get(m.businessId) ?? "—",
        createdAt: m.createdAt,
        category: resolvedCategory,
        questionText: questionRaw ? truncate(questionRaw) : null,
        answerText: m.content ? truncate(m.content) : null,
        latencyMs: m.latencyMs,
        retrievalTopScore: m.retrievalTopScore,
        retrievedChunkCount: m.retrievedChunkIds.length,
        modelUsed: m.modelUsed,
        flagged: m.flagged,
        feedback: m.feedback,
        gatewayError: resolvedCategory === "gateway_error" ? nearestGatewayError(m.businessId, m.createdAt) : undefined,
      };
    });

    return { days, hasMore, limit, offset, items };
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

  async listAdminUsers() {
    return this.prisma.client.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
      orderBy: { name: "asc" },
    });
  }

  async createAdminUser(email: string, name: string, role: string, password: string) {
    const normalizedEmail = (email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException("Email inválido.");
    }
    if (!password || password.length < 8) {
      throw new BadRequestException("A senha deve ter pelo menos 8 caracteres.");
    }
    if (role !== "superadmin" && role !== "support") {
      throw new BadRequestException("Papel inválido.");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await this.prisma.client.adminUser.create({
      data: { email: normalizedEmail, name, role, passwordHash },
    });
    return { id: admin.id, email: admin.email, name: admin.name, role: admin.role, lastLoginAt: admin.lastLoginAt };
  }

  async deleteAdminUser(id: string) {
    // Count-then-delete inside one transaction closes the race where two concurrent deletes
    // could both pass a stale "at least one left" check and leave zero superadmins able to log in.
    await this.prisma.client.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({ where: { id }, select: { role: true } });
      if (!target) throw new BadRequestException("Administrador não encontrado.");
      if (target.role === "superadmin") {
        const remainingSuperadmins = await tx.adminUser.count({ where: { role: "superadmin", id: { not: id } } });
        if (remainingSuperadmins < 1) {
          throw new BadRequestException("Não é possível remover o último superadmin.");
        }
      }
      await tx.adminUser.delete({ where: { id } });
    });
    return { ok: true };
  }
}

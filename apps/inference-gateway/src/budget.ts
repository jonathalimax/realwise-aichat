import { prisma } from "@realwise/db";
import { estimateCostUsd, getEntryPlan } from "@realwise/shared";

// Fallback chain for a tenant's monthly LLM budget cap: Business.llmMonthlyBudgetUsdCents (admin
// override) -> Plan.llmMonthlyBudgetUsdCents (plan-tier default) -> this constant (business with no
// active subscription — fail-open to the entry (essencial) plan's budget from the shared plan
// catalog, NOT pre-downgraded).
export const DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS = getEntryPlan().llmMonthlyBudgetUsdCents;

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const EVICTION_IDLE_MS = 60 * 60 * 1000; // 1 hour
const ALERT_THRESHOLD_RATIO = 0.8;

interface CacheEntry {
  timezone: string;
  monthKey: string;
  monthStart: Date;
  budgetUsdCents: number | null;
  spentUsdCents: number;
  refreshedAt: number;
  lastAccessedAt: number;
  alertedAt80Pct: boolean;
}

const cache = new Map<string, CacheEntry>();

// Start of the current calendar month in the given IANA timezone, returned as a UTC Date usable
// directly in a Prisma `gte` filter.
export function monthStartUtcForTimezone(tz: string, now: Date): Date {
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
  // Offset between the tenant-local wall-clock reading and the actual UTC instant `now`, so we can
  // compute the UTC instant corresponding to local midnight on day 1 of the local month.
  const localAsUtc = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const localNowAsUtc = Date.UTC(year, month - 1, Number(get("day")), hour, Number(get("minute")), Number(get("second")));
  const offsetMs = localNowAsUtc - now.getTime();
  return new Date(localAsUtc - offsetMs);
}

// Cache-invalidation key like "2026-10" in the tenant's local timezone, so the in-memory cache
// naturally resets at the tenant's local calendar-month boundary.
export function monthKey(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function evictStale(now: number) {
  for (const [key, entry] of cache) {
    if (now - entry.lastAccessedAt > EVICTION_IDLE_MS) cache.delete(key);
  }
}

async function refreshEntry(businessId: string, now: Date): Promise<CacheEntry> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      timezone: true,
      llmMonthlyBudgetUsdCents: true,
      subscription: { select: { plan: { select: { llmMonthlyBudgetUsdCents: true } } } },
    },
  });

  const tz = business?.timezone ?? "America/Sao_Paulo";
  const budgetUsdCents =
    business?.llmMonthlyBudgetUsdCents ??
    business?.subscription?.plan?.llmMonthlyBudgetUsdCents ??
    DEFAULT_LLM_MONTHLY_BUDGET_USD_CENTS;

  const key = monthKey(tz, now);
  const monthStart = monthStartUtcForTimezone(tz, now);

  const calls = await prisma.llmCallLog.findMany({
    where: { businessId, createdAt: { gte: monthStart } },
    select: { provider: true, model: true, inputTokens: true, outputTokens: true },
  });

  let spentUsdCents = 0;
  for (const call of calls) {
    spentUsdCents += estimateCostUsd(call.provider, call.model, call.inputTokens, call.outputTokens) * 100;
  }

  return {
    timezone: tz,
    monthKey: key,
    monthStart,
    budgetUsdCents,
    spentUsdCents,
    refreshedAt: Date.now(),
    lastAccessedAt: Date.now(),
    alertedAt80Pct: false,
  };
}

async function maybeRaiseBudgetAlert(businessId: string, entry: CacheEntry, monthStart: Date) {
  if (entry.alertedAt80Pct) return;
  if (entry.budgetUsdCents === null) return;
  if (entry.spentUsdCents < entry.budgetUsdCents * ALERT_THRESHOLD_RATIO) return;

  entry.alertedAt80Pct = true;
  try {
    const existing = await prisma.businessAlert.findFirst({
      where: { businessId, type: "llm_budget_80pct", dismissedAt: null, createdAt: { gte: monthStart } },
    });
    if (existing) return;
    await prisma.businessAlert.create({
      data: {
        businessId,
        type: "llm_budget_80pct",
        severity: "warning",
        message:
          "Seu uso de IA este mês já atingiu 80% do orçamento do seu plano. Ao atingir 100%, o atendimento por chat passará a usar um modelo mais econômico até o próximo mês.",
      },
    });
  } catch (err) {
    console.error("[budget] failed to raise llm_budget_80pct alert", err);
  }
}

// In-flight refresh promises per businessId, so concurrent callers for the same tenant during a
// stale/missing cache window await the SAME DB refresh instead of each starting a new one (avoids
// a cache stampede), and so recordSpend can apply increments to whatever entry eventually lands in
// the cache rather than to a stale object that's about to be discarded by the refresh completing.
const inFlightRefresh = new Map<string, Promise<CacheEntry>>();

// Spend increments (in USD cents) that arrived while a refresh was in-flight for this businessId,
// to be applied to the entry once the in-flight refresh resolves and is cached — otherwise they'd
// be silently lost when refreshEntry's cache.set() overwrites the entry recordSpend mutated.
const pendingSpendDuringRefresh = new Map<string, number>();

function getOrStartRefresh(businessId: string, now: Date): Promise<CacheEntry> {
  const existing = inFlightRefresh.get(businessId);
  if (existing) return existing;

  const promise = refreshEntry(businessId, now)
    .then((entry) => {
      const pending = pendingSpendDuringRefresh.get(businessId);
      if (pending) {
        entry.spentUsdCents += pending;
        pendingSpendDuringRefresh.delete(businessId);
      }
      cache.set(businessId, entry);
      return entry;
    })
    .finally(() => {
      inFlightRefresh.delete(businessId);
      // Flush any spend that was queued in the microtask gap between the refresh resolving (and
      // consuming `pendingSpendDuringRefresh` above) and this `finally` removing the in-flight
      // marker — otherwise `recordSpend` calls landing in that gap would be silently dropped.
      const leftover = pendingSpendDuringRefresh.get(businessId);
      if (leftover) {
        const cached = cache.get(businessId);
        if (cached) cached.spentUsdCents += leftover;
        pendingSpendDuringRefresh.delete(businessId);
      }
    });

  inFlightRefresh.set(businessId, promise);
  return promise;
}

export async function isOverMonthlyBudget(businessId: string): Promise<boolean> {
  try {
    const now = new Date();
    const now_ms = Date.now();
    evictStale(now_ms);

    const cached = cache.get(businessId);
    const stale = !cached || now_ms - cached.refreshedAt > TTL_MS || cached.monthKey !== monthKey(cached.timezone, now);

    let entry: CacheEntry;
    if (stale) {
      entry = await getOrStartRefresh(businessId, now);
    } else {
      entry = cached;
      entry.lastAccessedAt = now_ms;
    }

    await maybeRaiseBudgetAlert(businessId, entry, entry.monthStart);

    if (entry.budgetUsdCents === null) return false;
    return entry.spentUsdCents >= entry.budgetUsdCents;
  } catch (err) {
    console.error("[budget] isOverMonthlyBudget failed, failing open", err);
    return false;
  }
}

// Accrue spend from a just-completed call into an already-cached entry (avoids a DB round-trip on
// every call). If a refresh is currently in-flight for this businessId, the increment is queued and
// applied to the entry once that refresh resolves and is cached, so it can't be silently discarded
// by the refresh's cache.set() overwriting the entry we'd otherwise mutate here. No-op if there's
// neither a cache entry nor an in-flight refresh — the next real check will do a fresh DB read.
export function recordSpend(businessId: string, usdCents: number): void {
  if (inFlightRefresh.has(businessId)) {
    pendingSpendDuringRefresh.set(businessId, (pendingSpendDuringRefresh.get(businessId) ?? 0) + usdCents);
    return;
  }
  const entry = cache.get(businessId);
  if (!entry) return;
  entry.spentUsdCents += usdCents;
}

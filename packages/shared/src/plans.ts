// Single source of truth for Realwise plans: prices, quotas, feature flags and the display copy
// the dashboard and both marketing pages render. Seed (packages/db/prisma/seed.ts), billing,
// usage/quota checks and the marketing pricing section all read from here — change a number here,
// not in a page or in the seed.
//
// Pricing model (owner decision): three flat monthly plans, setup is always free, no
// pay-as-you-go and no overage billing. Going over the conversation quota keeps the existing
// behavior (owner alerts + "Ver planos" prompt + new visitors routed straight to the team).
// Stripe price IDs are NOT stored here — they're read from env at checkout time, see
// `stripePriceEnvVar` and apps/api/src/modules/billing/stripe-prices.ts.

export type PlanCode = "essencial" | "profissional" | "studio";
export type AnalyticsTier = "basic" | "full";
export type LearningLoopTier = "digest" | "full" | "coach";

// Convention already used by the Plan table for "no document limit".
export const UNLIMITED_DOCUMENT_QUOTA = 999999;

export interface PlanFeatures {
  analytics: AnalyticsTier;
  calendarSync: boolean;
  branding: boolean;
  customDomain: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
  // Knowledge learning loop (PR 2, not implemented yet) — gating keys only.
  learningLoop: LearningLoopTier;
  // Max saved answers the learning loop may keep; null = unlimited.
  learningSavedAnswersCap: number | null;
  suggestedDrafts: boolean;
  whatsappAlerts: boolean;
  crmWebhook: boolean;
  // Pharmacy niche: stock, catalog, orders, prescriptions and the cart/checkout in chat. Plans
  // without it run the pharmacy in "attendance" mode (AI attendant + pharmacist handoffs only).
  pharmacyCommerce: boolean;
}

export type PlanFeatureKey = keyof PlanFeatures;

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  // Launch price actually charged (BRL cents/month) — must match the Stripe price behind
  // `stripePriceEnvVar`.
  priceBrlCents: number;
  // Future list price, display only (shown struck-through next to the launch price).
  listPriceBrlCents: number;
  conversationQuota: number;
  documentQuota: number;
  whatsappNumberQuota: number;
  llmMonthlyBudgetUsdCents: number;
  features: PlanFeatures;
  // Env var holding this plan's monthly recurring Stripe price ID.
  stripePriceEnvVar: `STRIPE_PRICE_${string}`;
  recommended: boolean;
}

const BASE_FEATURES: PlanFeatures = {
  analytics: "basic",
  calendarSync: false,
  branding: false,
  customDomain: false,
  prioritySupport: false,
  dedicatedSupport: false,
  learningLoop: "digest",
  learningSavedAnswersCap: 20,
  suggestedDrafts: false,
  whatsappAlerts: false,
  crmWebhook: false,
  pharmacyCommerce: false,
};

const PROFISSIONAL_FEATURES: PlanFeatures = {
  ...BASE_FEATURES,
  analytics: "full",
  calendarSync: true,
  branding: true,
  customDomain: true,
  prioritySupport: true,
  learningLoop: "full",
  learningSavedAnswersCap: null,
  pharmacyCommerce: true,
};

// Ordered cheapest -> most expensive; this order is the upgrade path.
export const PLAN_CATALOG: readonly PlanDefinition[] = Object.freeze([
  {
    code: "essencial",
    name: "Essencial",
    priceBrlCents: 19700,
    listPriceBrlCents: 29700,
    conversationQuota: 150,
    documentQuota: 10,
    whatsappNumberQuota: 1,
    llmMonthlyBudgetUsdCents: 300,
    features: BASE_FEATURES,
    stripePriceEnvVar: "STRIPE_PRICE_ESSENCIAL",
    recommended: false,
  },
  {
    code: "profissional",
    name: "Profissional",
    priceBrlCents: 39700,
    listPriceBrlCents: 59700,
    conversationQuota: 1000,
    documentQuota: 50,
    whatsappNumberQuota: 3,
    llmMonthlyBudgetUsdCents: 1000,
    features: PROFISSIONAL_FEATURES,
    stripePriceEnvVar: "STRIPE_PRICE_PROFISSIONAL",
    recommended: true,
  },
  {
    code: "studio",
    name: "Studio",
    priceBrlCents: 79700,
    listPriceBrlCents: 119700,
    conversationQuota: 3000,
    documentQuota: UNLIMITED_DOCUMENT_QUOTA,
    whatsappNumberQuota: 10,
    llmMonthlyBudgetUsdCents: 3000,
    features: {
      ...PROFISSIONAL_FEATURES,
      dedicatedSupport: true,
      learningLoop: "coach",
      suggestedDrafts: true,
      whatsappAlerts: true,
      crmWebhook: true,
    },
    stripePriceEnvVar: "STRIPE_PRICE_STUDIO",
    recommended: false,
  },
] satisfies PlanDefinition[]);

export const PLAN_CODES: readonly PlanCode[] = PLAN_CATALOG.map((p) => p.code);

// Plan whose limits apply to a business with no subscription yet (trial): quota, LLM budget and
// features all fall back to the entry tier.
export const ENTRY_PLAN_CODE: PlanCode = "essencial";

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

export function getPlanDefinition(code: string | null | undefined): PlanDefinition | undefined {
  return PLAN_CATALOG.find((p) => p.code === code);
}

export function getEntryPlan(): PlanDefinition {
  return getPlanDefinition(ENTRY_PLAN_CODE)!;
}

// Next tier on the upgrade path (essencial -> profissional -> studio); undefined at the top tier.
// No/unknown plan (trial) already gets the entry tier's limits, so its next step up is the tier
// above the entry plan — suggesting the entry plan itself wouldn't raise the quota.
export function getNextPlanUp(code: string | null | undefined): PlanDefinition | undefined {
  const effective = isPlanCode(code) ? code : ENTRY_PLAN_CODE;
  const index = PLAN_CATALOG.findIndex((p) => p.code === effective);
  return PLAN_CATALOG[index + 1];
}

export function isUnlimitedDocumentQuota(quota: number): boolean {
  return quota >= UNLIMITED_DOCUMENT_QUOTA;
}

// Feature flags for a plan row/subscription. Known plan codes always use the catalog (so a DB row
// seeded before a new flag existed still gets it); an unknown code falls back to its stored
// `features` JSON over the entry-tier defaults; no plan (trial) = entry tier.
export function resolvePlanFeatures(plan: { code?: string | null; features?: unknown } | null | undefined): PlanFeatures {
  const known = getPlanDefinition(plan?.code);
  if (known) return { ...known.features };
  const base = getEntryPlan().features;
  if (!plan || typeof plan.features !== "object" || plan.features === null) return { ...base };
  const stored = plan.features as Record<string, unknown>;
  const merged: PlanFeatures = { ...base };
  for (const key of Object.keys(base) as PlanFeatureKey[]) {
    const value = stored[key];
    const fallback = base[key];
    const sameType = typeof value === typeof fallback;
    const nullableNumber = key === "learningSavedAnswersCap" && (value === null || typeof value === "number");
    if (value !== undefined && (sameType || nullableNumber)) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

// --- Display helpers (pt-BR) ---------------------------------------------------------------

// Whole-real BRL, e.g. 19700 -> "R$197", 119700 -> "R$1.197".
export function formatPlanPriceBrl(cents: number): string {
  return `R$${formatCount(Math.round(cents / 100))}`;
}

// pt-BR thousands separator without relying on the runtime's ICU data, e.g. 3000 -> "3.000".
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export const PRICING_COPY = Object.freeze({
  setupFree: "Setup sempre grátis — você paga só a mensalidade. Sem cobrança por uso excedente.",
  launchPriceLabel: "Preço de lançamento",
  conversationDefinition:
    "O que conta como conversa? Uma sessão onde a IA de fato responde algo — perguntas de fluxo fixo (horário, endereço) não contam.",
  overQuota:
    "Passou do limite? Nada é cobrado a mais: você recebe um aviso e as novas conversas vão direto para a sua equipe até o próximo ciclo ou um upgrade.",
  annual: "Anual sai 2 meses grátis.",
});

// Bullet list shown on pricing cards. Only implemented features are advertised — the learning
// loop / drafts / WhatsApp alerts / CRM webhook flags exist for gating but aren't sold yet.
export function planHighlights(plan: PlanDefinition): string[] {
  const f = plan.features;
  const items = [
    `${formatCount(plan.conversationQuota)} conversas/mês`,
    isUnlimitedDocumentQuota(plan.documentQuota) ? "Documentos ilimitados" : `${formatCount(plan.documentQuota)} documentos na base`,
    plan.whatsappNumberQuota === 1 ? "1 número de WhatsApp" : `${plan.whatsappNumberQuota} números de WhatsApp`,
    "Agendamento embutido",
    f.analytics === "full" ? "Analytics completo" : "Analytics básico",
  ];
  if (f.calendarSync) items.push("Sincronização com Google Calendar");
  if (f.branding && f.customDomain) items.push("Sua marca e domínio próprio");
  else if (f.branding) items.push("Sua marca no chat");
  if (f.dedicatedSupport) items.push("Suporte dedicado");
  else if (f.prioritySupport) items.push("Suporte prioritário");
  return items;
}

// Extra pricing bullets for the pharmacy niche (marketing pharmacy page, pharmacy billing page).
// Kept apart from planHighlights() so the generic bullets stay untouched.
export function pharmacyPlanHighlights(plan: PlanDefinition): string[] {
  return plan.features.pharmacyCommerce
    ? ["Catálogo, estoque e pedidos pelo chat (modo comércio)", "Receitas e revisão de classes pelo farmacêutico"]
    : ["Atendimento com IA e encaminhamento ao farmacêutico (modo atendimento)", "Sem catálogo, estoque ou pedidos online"];
}

// --- Conversation quota alerts ------------------------------------------------------------

export type QuotaAlertType = "quota_exceeded" | "quota_warning_95" | "quota_warning_80";

export interface QuotaAlert {
  type: QuotaAlertType;
  severity: "critical" | "warning";
  message: string;
  actionLabel: "Ver planos";
  actionHref: "/billing";
}

function upgradeHint(planCode: string | null | undefined): string {
  const next = getNextPlanUp(planCode);
  if (!next) return "Você já está no maior plano — fale com a gente se precisar de mais conversas.";
  return `Faça upgrade para o ${next.name} (${formatCount(next.conversationQuota)} conversas/mês).`;
}

// Owner-facing alert for the current month's conversation usage; null below 80%.
export function buildQuotaAlert(
  used: number,
  quota: number,
  planCode: string | null | undefined,
  personaName: string,
): QuotaAlert | null {
  if (quota <= 0) return null;
  const percent = (used / quota) * 100;
  const base = { actionLabel: "Ver planos" as const, actionHref: "/billing" as const };
  if (percent >= 100) {
    const next = getNextPlanUp(planCode);
    return {
      ...base,
      type: "quota_exceeded",
      severity: "critical",
      message: next
        ? `Você atingiu 100% das conversas do seu plano este mês — novas conversas estão sendo encaminhadas direto para sua equipe. Faça upgrade para o ${next.name} para voltar a ser atendido por ${personaName}.`
        : `Você atingiu 100% das conversas do seu plano este mês — novas conversas estão sendo encaminhadas direto para sua equipe até o início do próximo ciclo. Fale com a gente se precisar de mais conversas.`,
    };
  }
  if (percent >= 95) {
    return {
      ...base,
      type: "quota_warning_95",
      severity: "warning",
      message: `Você já usou 95% das conversas do seu plano este mês. ${upgradeHint(planCode)}`,
    };
  }
  if (percent >= 80) {
    return {
      ...base,
      type: "quota_warning_80",
      severity: "warning",
      message: `Você já usou 80% das conversas do seu plano este mês. ${upgradeHint(planCode)}`,
    };
  }
  return null;
}

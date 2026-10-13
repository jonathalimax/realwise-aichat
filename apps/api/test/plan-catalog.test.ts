import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENTRY_PLAN_CODE,
  PLAN_CATALOG,
  PLAN_CODES,
  PRICING_COPY,
  UNLIMITED_DOCUMENT_QUOTA,
  buildQuotaAlert,
  formatCount,
  formatPlanPriceBrl,
  getEntryPlan,
  getNextPlanUp,
  getPlanDefinition,
  isPlanCode,
  planHighlights,
  resolvePlanFeatures,
} from "@realwise/shared";

const REPO_ROOT = join(__dirname, "..", "..", "..");

test("catalog has exactly the three plans, in upgrade order", () => {
  assert.deepEqual([...PLAN_CODES], ["essencial", "profissional", "studio"]);
  const prices = PLAN_CATALOG.map((p) => p.priceBrlCents);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(PLAN_CATALOG.filter((p) => p.recommended).length, 1);
  assert.equal(getPlanDefinition("profissional")?.recommended, true);
});

test("catalog values match the owner's pricing table", () => {
  const table = PLAN_CATALOG.map((p) => ({
    code: p.code,
    price: p.priceBrlCents,
    list: p.listPriceBrlCents,
    conv: p.conversationQuota,
    docs: p.documentQuota,
    wa: p.whatsappNumberQuota,
    llm: p.llmMonthlyBudgetUsdCents,
    env: p.stripePriceEnvVar,
  }));
  assert.deepEqual(table, [
    { code: "essencial", price: 19700, list: 29700, conv: 150, docs: 10, wa: 1, llm: 300, env: "STRIPE_PRICE_ESSENCIAL" },
    { code: "profissional", price: 39700, list: 59700, conv: 1000, docs: 50, wa: 3, llm: 1000, env: "STRIPE_PRICE_PROFISSIONAL" },
    { code: "studio", price: 79700, list: 119700, conv: 3000, docs: UNLIMITED_DOCUMENT_QUOTA, wa: 10, llm: 3000, env: "STRIPE_PRICE_STUDIO" },
  ]);
  assert.equal(UNLIMITED_DOCUMENT_QUOTA, 999999);
  for (const p of PLAN_CATALOG) assert.ok(p.listPriceBrlCents > p.priceBrlCents, `${p.code} list price above launch price`);
});

test("no setup fee anywhere in the catalog", () => {
  for (const plan of PLAN_CATALOG) {
    const keys = Object.keys(plan).map((k) => k.toLowerCase());
    assert.ok(!keys.some((k) => k.includes("setup")), `${plan.code} has a setup-related field`);
  }
  assert.match(PRICING_COPY.setupFree, /grátis/);
});

test("feature flags per plan", () => {
  const [essencial, profissional, studio] = PLAN_CATALOG.map((p) => p.features);
  assert.deepEqual(essencial, {
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
  });
  assert.deepEqual(profissional, {
    analytics: "full",
    calendarSync: true,
    branding: true,
    customDomain: true,
    prioritySupport: true,
    dedicatedSupport: false,
    learningLoop: "full",
    learningSavedAnswersCap: null,
    suggestedDrafts: false,
    whatsappAlerts: false,
    crmWebhook: false,
  });
  assert.deepEqual(studio, {
    ...profissional,
    dedicatedSupport: true,
    learningLoop: "coach",
    suggestedDrafts: true,
    whatsappAlerts: true,
    crmWebhook: true,
  });
});

test("upgrade path and entry plan", () => {
  assert.equal(ENTRY_PLAN_CODE, "essencial");
  assert.equal(getEntryPlan().code, "essencial");
  assert.equal(getNextPlanUp("essencial")?.code, "profissional");
  assert.equal(getNextPlanUp("profissional")?.code, "studio");
  assert.equal(getNextPlanUp("studio"), undefined);
  assert.equal(getNextPlanUp(null)?.code, "profissional", "trial already has entry-tier limits");
  assert.equal(getNextPlanUp("legacy")?.code, "profissional");
  assert.equal(isPlanCode("studio"), true);
  assert.equal(isPlanCode("enterprise"), false);
  assert.equal(isPlanCode(undefined), false);
});

test("resolvePlanFeatures: catalog wins for known codes, entry tier for no plan", () => {
  // Stale DB JSON (pre-catalog seed) must not hide the new flags.
  const stale = resolvePlanFeatures({ code: "studio", features: { analytics: "full", branding: true } });
  assert.equal(stale.learningLoop, "coach");
  assert.equal(stale.crmWebhook, true);
  assert.deepEqual(resolvePlanFeatures(null), getEntryPlan().features);
  const unknown = resolvePlanFeatures({ code: "legacy", features: { analytics: "full", learningSavedAnswersCap: null, branding: "yes" } });
  assert.equal(unknown.analytics, "full");
  assert.equal(unknown.learningSavedAnswersCap, null);
  assert.equal(unknown.branding, false, "wrong-typed stored values are ignored");
  // Returned object is a copy — mutating it must not change the catalog.
  resolvePlanFeatures({ code: "essencial" }).analytics = "full";
  assert.equal(getEntryPlan().features.analytics, "basic");
});

test("price/number formatting", () => {
  assert.equal(formatPlanPriceBrl(19700), "R$197");
  assert.equal(formatPlanPriceBrl(119700), "R$1.197");
  assert.equal(formatCount(3000), "3.000");
  assert.equal(formatCount(150), "150");
});

test("highlights reflect quotas and only implemented features", () => {
  const [essencial, profissional, studio] = PLAN_CATALOG.map(planHighlights);
  assert.ok(essencial.includes("150 conversas/mês"));
  assert.ok(essencial.includes("10 documentos na base"));
  assert.ok(essencial.includes("1 número de WhatsApp"));
  assert.ok(essencial.includes("Analytics básico"));
  assert.ok(profissional.includes("1.000 conversas/mês"));
  assert.ok(profissional.includes("3 números de WhatsApp"));
  assert.ok(profissional.includes("Suporte prioritário"));
  assert.ok(studio.includes("3.000 conversas/mês"));
  assert.ok(studio.includes("Documentos ilimitados"));
  assert.ok(studio.includes("Suporte dedicado"));
  for (const list of [essencial, profissional, studio]) {
    assert.ok(!list.some((item) => /setup|webhook|CRM|rascunho/i.test(item)), list.join(", "));
  }
});

test("quota alerts: thresholds with the new quotas and next-tier wording", () => {
  assert.equal(buildQuotaAlert(119, 150, "essencial", "Clara"), null);
  const warn80 = buildQuotaAlert(120, 150, "essencial", "Clara");
  assert.equal(warn80?.type, "quota_warning_80");
  assert.match(warn80!.message, /Profissional \(1\.000 conversas\/mês\)/);
  assert.equal(buildQuotaAlert(143, 150, "essencial", "Clara")?.type, "quota_warning_95");
  const exceeded = buildQuotaAlert(150, 150, "essencial", "Clara");
  assert.equal(exceeded?.type, "quota_exceeded");
  assert.equal(exceeded?.severity, "critical");
  assert.equal(exceeded?.actionLabel, "Ver planos");
  assert.equal(exceeded?.actionHref, "/billing");
  assert.match(exceeded!.message, /upgrade para o Profissional.*Clara/);
  assert.match(buildQuotaAlert(2400, 3000, "profissional", "Clara")!.message, /Studio \(3\.000/);
  const top = buildQuotaAlert(3000, 3000, "studio", "Clara");
  assert.equal(top?.type, "quota_exceeded");
  assert.doesNotMatch(top!.message, /upgrade/i);
  assert.match(buildQuotaAlert(900, 1000, "studio", "Clara")!.message, /maior plano/);
  assert.equal(buildQuotaAlert(10, 0, "essencial", "Clara"), null);
  // Trial (no plan) runs on the entry quota, so the suggestion must be the tier above it.
  assert.match(buildQuotaAlert(150, 150, null, "Clara")!.message, /upgrade para o Profissional/);
});

// The marketing pages and dashboard must render plans from the catalog, never their own copies.
test("no hardcoded old prices/quotas left in pricing surfaces", () => {
  const files = [
    "apps/marketing/src/app/page.tsx",
    "apps/marketing/src/components/LandingPage.tsx",
    "apps/marketing/src/components/PricingSection.tsx",
    "apps/dashboard/src/app/billing/page.tsx",
    "packages/db/prisma/seed.ts",
  ];
  for (const file of files) {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.doesNotMatch(src, /R\$ ?(297|597|697|1\.197)\b/, `${file} hardcodes a price`);
    assert.doesNotMatch(src, /\b(5\.000|4\.000|1\.200) conversas/, `${file} hardcodes a quota`);
    assert.doesNotMatch(src, /price_[A-Za-z0-9]{8,}/, `${file} hardcodes a Stripe price ID`);
  }
  for (const file of ["apps/marketing/src/app/page.tsx", "apps/marketing/src/components/LandingPage.tsx"]) {
    assert.match(readFileSync(join(REPO_ROOT, file), "utf8"), /<PricingSection/, `${file} uses the shared PricingSection`);
  }
});

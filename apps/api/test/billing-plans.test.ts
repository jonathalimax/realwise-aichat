import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MissingStripePriceError,
  UnknownPlanError,
  missingStripePriceEnvVars,
  planCodeForStripePriceId,
  resolveStripePriceId,
} from "../src/modules/billing/stripe-prices";
import { buildPublicPlans } from "../src/modules/billing/public-plans";
import { getPlanFeatures, hasFeature } from "../src/modules/billing/plan-features";

const ENV = {
  STRIPE_PRICE_ESSENCIAL: "price_test_ess",
  STRIPE_PRICE_PROFISSIONAL: " price_test_pro ",
  STRIPE_PRICE_STUDIO: "price_test_stu",
};

test("resolveStripePriceId reads the plan's env var", () => {
  assert.equal(resolveStripePriceId("essencial", ENV), "price_test_ess");
  assert.equal(resolveStripePriceId("profissional", ENV), "price_test_pro", "trims whitespace");
  assert.equal(resolveStripePriceId("studio", ENV), "price_test_stu");
});

test("resolveStripePriceId fails clearly when the env var is missing/blank", () => {
  assert.throws(
    () => resolveStripePriceId("studio", { ...ENV, STRIPE_PRICE_STUDIO: "  " }),
    (err: unknown) => err instanceof MissingStripePriceError && /STRIPE_PRICE_STUDIO/.test(err.message),
  );
  assert.throws(() => resolveStripePriceId("enterprise", ENV), UnknownPlanError);
});

test("missingStripePriceEnvVars lists unset plan prices", () => {
  assert.deepEqual(missingStripePriceEnvVars(ENV), []);
  assert.deepEqual(missingStripePriceEnvVars({ STRIPE_PRICE_PROFISSIONAL: "x" }), ["STRIPE_PRICE_ESSENCIAL", "STRIPE_PRICE_STUDIO"]);
});

test("planCodeForStripePriceId maps a price back to its plan", () => {
  assert.equal(planCodeForStripePriceId("price_test_pro", ENV), "profissional");
  assert.equal(planCodeForStripePriceId("price_legacy", ENV), undefined);
  assert.equal(planCodeForStripePriceId(undefined, ENV), undefined);
  assert.equal(planCodeForStripePriceId("", {}), undefined);
});

test("buildPublicPlans: active plans only, upgrade order, no Stripe/setup fields", () => {
  const plans = buildPublicPlans([
    { code: "studio", isActive: true },
    { code: "essencial", isActive: true },
    { code: "profissional", isActive: false },
    { code: "legacy", isActive: true },
  ]);
  assert.deepEqual(plans.map((p) => p.code), ["essencial", "studio"]);
  const all = buildPublicPlans(["essencial", "profissional", "studio"].map((code) => ({ code, isActive: true })));
  assert.deepEqual(all.map((p) => [p.code, p.priceBrlCents, p.listPriceBrlCents]), [
    ["essencial", 19700, 29700],
    ["profissional", 39700, 59700],
    ["studio", 79700, 119700],
  ]);
  for (const plan of all) {
    const keys = Object.keys(plan).join(",").toLowerCase();
    assert.ok(!keys.includes("stripe") && !keys.includes("setup"), keys);
    assert.ok(plan.highlights.length > 0);
  }
});

test("getPlanFeatures / hasFeature", () => {
  assert.equal(getPlanFeatures({ code: "essencial" }).learningLoop, "digest");
  assert.equal(getPlanFeatures({ code: "profissional" }).learningLoop, "full");
  assert.equal(getPlanFeatures({ code: "studio" }).learningLoop, "coach");
  assert.equal(getPlanFeatures({ code: "essencial" }).learningSavedAnswersCap, 20);
  assert.equal(getPlanFeatures({ code: "profissional" }).learningSavedAnswersCap, null);
  assert.equal(hasFeature({ code: "studio" }, "suggestedDrafts"), true);
  assert.equal(hasFeature({ code: "profissional" }, "suggestedDrafts"), false);
  assert.equal(hasFeature({ code: "studio" }, "whatsappAlerts"), true);
  assert.equal(hasFeature({ code: "studio" }, "crmWebhook"), true);
  assert.equal(hasFeature({ code: "profissional" }, "calendarSync"), true);
  assert.equal(hasFeature(null, "calendarSync"), false, "no subscription = entry tier");
  assert.equal(getPlanFeatures(null).analytics, "basic");
});

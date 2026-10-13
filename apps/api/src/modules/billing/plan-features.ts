import { resolvePlanFeatures, type PlanFeatures } from "@realwise/shared";

// Plan feature gating for API modules. Pass the subscription's plan row (or null for a business
// without a subscription — it gets the entry tier's features). Values come from the shared plan
// catalog (packages/shared/src/plans.ts).
type PlanLike = { code?: string | null; features?: unknown } | null | undefined;

export type BooleanPlanFeatureKey = { [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never }[keyof PlanFeatures];

export function getPlanFeatures(plan: PlanLike): PlanFeatures {
  return resolvePlanFeatures(plan);
}

// On/off flags only (calendarSync, suggestedDrafts, crmWebhook, ...). Tiered/numeric flags
// (analytics, learningLoop, learningSavedAnswersCap) are read with getPlanFeatures(plan)[key].
export function hasFeature(plan: PlanLike, key: BooleanPlanFeatureKey): boolean {
  return getPlanFeatures(plan)[key] === true;
}

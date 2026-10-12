import { PLAN_CATALOG, getPlanDefinition, type PlanCode } from "@realwise/shared";

// Stripe prices are immutable, so the monthly recurring price for each plan is created by the
// owner in the Stripe dashboard and wired in through env (STRIPE_PRICE_ESSENCIAL,
// STRIPE_PRICE_PROFISSIONAL, STRIPE_PRICE_STUDIO) — never hardcoded and never read from the
// Plan table's legacy stripePriceId column.

type Env = Record<string, string | undefined>;

export class MissingStripePriceError extends Error {
  constructor(
    readonly planCode: string,
    readonly envVar: string,
  ) {
    super(`Stripe price for plan "${planCode}" is not configured: set ${envVar} to the plan's monthly recurring price ID`);
    this.name = "MissingStripePriceError";
  }
}

export class UnknownPlanError extends Error {
  constructor(readonly planCode: string) {
    super(`Unknown plan code "${planCode}"`);
    this.name = "UnknownPlanError";
  }
}

export function resolveStripePriceId(planCode: string, env: Env = process.env): string {
  const plan = getPlanDefinition(planCode);
  if (!plan) throw new UnknownPlanError(planCode);
  const priceId = env[plan.stripePriceEnvVar]?.trim();
  if (!priceId) throw new MissingStripePriceError(plan.code, plan.stripePriceEnvVar);
  return priceId;
}

// Reverse lookup used by subscription webhooks (e.g. a plan switch made in the Stripe billing
// portal): which plan does this Stripe price belong to? Undefined for unknown/legacy prices.
export function planCodeForStripePriceId(priceId: string | null | undefined, env: Env = process.env): PlanCode | undefined {
  if (!priceId) return undefined;
  return PLAN_CATALOG.find((p) => env[p.stripePriceEnvVar]?.trim() === priceId)?.code;
}

// Env vars of plans whose price isn't configured — logged once at startup so a missing price is
// visible before a customer hits checkout.
export function missingStripePriceEnvVars(env: Env = process.env): string[] {
  return PLAN_CATALOG.filter((p) => !env[p.stripePriceEnvVar]?.trim()).map((p) => p.stripePriceEnvVar);
}

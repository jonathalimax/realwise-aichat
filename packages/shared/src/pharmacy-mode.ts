// Pharmacy operation mode (single source of truth for api, dashboard and chat).
//   commerce   -> catalog, stock, cart/checkout in chat, orders, prescriptions, class review, import.
//   attendance -> only the AI attendant (Alex) with escalation to the pharmacist, like a WhatsApp with AI.
// The owner CHOOSES a mode (PharmacySettings.operationMode); the plan decides what is ALLOWED
// (PlanFeatures.pharmacyCommerce). Effective mode = chosen mode, forced to attendance when the plan
// lacks the feature. Nothing is deleted on a downgrade: commerce data stays, just unreachable.

import { getNextPlanUp, resolvePlanFeatures } from "./plans";

export type OperationMode = "commerce" | "attendance";
export const OPERATION_MODES: readonly OperationMode[] = ["commerce", "attendance"];

export function isOperationMode(v: unknown): v is OperationMode {
  return v === "commerce" || v === "attendance";
}

export interface OperationModeInfo {
  /** What the owner picked (stored). */
  chosen: OperationMode;
  /** What actually runs: chosen mode, forced to attendance when the plan lacks commerce. */
  effective: OperationMode;
  /** PlanFeatures.pharmacyCommerce of the current plan (trial / no plan = entry tier = false). */
  commerceAllowedByPlan: boolean;
  /** The owner chose commerce but the plan does not allow it (downgrade / trial). */
  forcedByPlan: boolean;
  chosenAt: string | null;
  planCode: string | null;
  /** Cheapest plan that allows commerce, for the upgrade CTA (null when already allowed). */
  upgradeToPlanCode: string | null;
}

export function computeOperationMode(
  chosenRaw: unknown,
  plan: { code?: string | null; features?: unknown } | null | undefined,
  chosenAt?: Date | string | null,
): OperationModeInfo {
  const chosen: OperationMode = isOperationMode(chosenRaw) ? chosenRaw : "attendance";
  const commerceAllowedByPlan = resolvePlanFeatures(plan).pharmacyCommerce === true;
  const effective: OperationMode = chosen === "commerce" && commerceAllowedByPlan ? "commerce" : "attendance";
  let upgradeToPlanCode: string | null = null;
  if (!commerceAllowedByPlan) {
    let next = getNextPlanUp(plan?.code ?? null);
    while (next && !next.features.pharmacyCommerce) next = getNextPlanUp(next.code);
    upgradeToPlanCode = next?.code ?? null;
  }
  return {
    chosen,
    effective,
    commerceAllowedByPlan,
    forcedByPlan: chosen === "commerce" && !commerceAllowedByPlan,
    chosenAt: chosenAt ? new Date(chosenAt).toISOString() : null,
    planCode: plan?.code ?? null,
    upgradeToPlanCode,
  };
}

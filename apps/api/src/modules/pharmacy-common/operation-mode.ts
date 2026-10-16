// Resolves a pharmacy's operation mode (chosen mode + plan -> effective mode) from the database.
// Pure rules live in @realwise/shared (computeOperationMode); this only loads the two inputs.
// Business without a subscription (trial) = entry plan = attendance only, as the plan catalog says.

import { computeOperationMode, type OperationModeInfo } from "@realwise/shared";

interface Db {
  pharmacySettings: { findUnique(args: any): Promise<any> };
  subscription: { findUnique(args: any): Promise<any> };
}

export async function loadOperationMode(client: any, businessId: string): Promise<OperationModeInfo> {
  const db = client as Db;
  const [settings, subscription] = await Promise.all([
    db.pharmacySettings.findUnique({ where: { businessId }, select: { operationMode: true, operationModeChosenAt: true } }).catch(() => null),
    db.subscription.findUnique({ where: { businessId }, select: { plan: { select: { code: true, features: true } } } }).catch(() => null),
  ]);
  return computeOperationMode(settings?.operationMode, subscription?.plan ?? null, settings?.operationModeChosenAt ?? null);
}

/** 403 payload for commerce-only routes. PLAN_FEATURE when the plan blocks it, MODE_ATTENDANCE when the owner chose attendance. */
export function commerceBlocked(info: OperationModeInfo): { code: "PLAN_FEATURE" | "MODE_ATTENDANCE"; message: string } {
  if (!info.commerceAllowedByPlan) {
    return {
      code: "PLAN_FEATURE",
      message: "Catálogo, estoque e pedidos estão disponíveis a partir do plano Profissional. Seus dados continuam guardados.",
    };
  }
  return {
    code: "MODE_ATTENDANCE",
    message: "Esta farmácia está no modo atendimento (sem catálogo, estoque ou pedidos). O proprietário pode mudar o modo em Farmácia.",
  };
}

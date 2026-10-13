import { PLAN_CATALOG, planHighlights, type PlanCode } from "@realwise/shared";

export interface PublicPlan {
  code: PlanCode;
  name: string;
  priceBrlCents: number;
  listPriceBrlCents: number;
  conversationQuota: number;
  documentQuota: number;
  whatsappNumberQuota: number;
  recommended: boolean;
  highlights: string[];
}

// What GET /billing/plans returns: the catalog entries whose Plan row is active, in upgrade order
// (essencial -> profissional -> studio). Numbers/copy come from the catalog; the DB row only
// decides availability. No Stripe IDs or legacy setup-fee columns are exposed.
export function buildPublicPlans(rows: Array<{ code: string; isActive: boolean }>): PublicPlan[] {
  const active = new Set(rows.filter((r) => r.isActive).map((r) => r.code));
  return PLAN_CATALOG.filter((p) => active.has(p.code)).map((p) => ({
    code: p.code,
    name: p.name,
    priceBrlCents: p.priceBrlCents,
    listPriceBrlCents: p.listPriceBrlCents,
    conversationQuota: p.conversationQuota,
    documentQuota: p.documentQuota,
    whatsappNumberQuota: p.whatsappNumberQuota,
    recommended: p.recommended,
    highlights: planHighlights(p),
  }));
}

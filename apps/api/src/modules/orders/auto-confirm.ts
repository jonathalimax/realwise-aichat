// Pure order-entry rules: what may enter a cart (canEnterCart) and whether an order may be confirmed
// without a human (autoConfirmDecision). Code decides, never the model (HANDOFF 5.2 / 5.5).

import { fold } from "../pharmacy-common/format";
import type { SaleClass } from "../pharmacy-common/labels";
import type { Fulfillment } from "./order-state";

export interface CartProductLike {
  saleClass: SaleClass;
  classConfirmedAt: Date | null;
  pharmacistRequired: boolean;
  active: boolean;
  stockQty: number | null;
  maxQtyPerOrder: number | null;
}

export type CartRefusal =
  | "inactive"
  | "controlled"
  | "unclassified"
  | "class_unconfirmed"
  | "pharmacist_required"
  | "prescription_required"
  | "out_of_stock"
  | "qty_over_limit"
  | "invalid_qty";

export type CartVerdict = { ok: true } | { ok: false; reason: CartRefusal; maxQty?: number };

export function effectiveMaxQty(p: Pick<CartProductLike, "maxQtyPerOrder">, defaultMax: number | null | undefined): number | null {
  return p.maxQtyPerOrder ?? defaultMax ?? null;
}

/**
 * Hard rules. controlled / unclassified NEVER enter a cart. prescription only with an attached
 * prescription upload (and the order then always waits for the pharmacist). Only a CONFIRMED class counts.
 */
export function canEnterCart(
  p: CartProductLike,
  qty: number,
  ctx: { maxQtyDefault?: number | null; hasPrescriptionUpload: boolean },
): CartVerdict {
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "invalid_qty" };
  if (!p.active) return { ok: false, reason: "inactive" };
  if (p.saleClass === "controlled") return { ok: false, reason: "controlled" };
  if (p.saleClass === "unclassified") return { ok: false, reason: "unclassified" };
  if (!p.classConfirmedAt) return { ok: false, reason: "class_unconfirmed" };
  if (p.saleClass === "otc" && p.pharmacistRequired) return { ok: false, reason: "pharmacist_required" };
  if (p.saleClass === "prescription" && !ctx.hasPrescriptionUpload) return { ok: false, reason: "prescription_required" };
  if ((p.stockQty ?? 0) < qty) return { ok: false, reason: "out_of_stock" };
  const max = effectiveMaxQty(p, ctx.maxQtyDefault);
  if (max !== null && qty > max) return { ok: false, reason: "qty_over_limit", maxQty: max };
  return { ok: true };
}

export interface DeliveryArea {
  type: "district" | "cep_prefix";
  value: string;
}

export function addressInsideAreas(address: { district?: string | null; cep?: string | null } | null | undefined, areas: DeliveryArea[]): boolean {
  if (!address || !areas.length) return false;
  const district = fold(address.district);
  const cep = (address.cep ?? "").replace(/\D/g, "");
  return areas.some((a) => (a.type === "district" ? !!district && fold(a.value) === district : !!cep && cep.startsWith(a.value.replace(/\D/g, ""))));
}

export interface AutoConfirmInput {
  autoConfirmEnabled: boolean;
  stockMaxAgeHours: number;
  maxQtyDefault: number | null;
  deliveryAreas: DeliveryArea[];
  fulfillment: Fulfillment;
  address?: { district?: string | null; cep?: string | null } | null;
  hasPrescription: boolean;
  /** Latest applied sheet's stockAsOf (null = no sheet ever). */
  sheetAsOf: Date | null;
  now?: number;
  items: Array<CartProductLike & { qty: number }>;
}

export interface AutoConfirmDecision {
  auto: boolean;
  /** Why not (empty when auto). Stable codes, never customer-visible text. */
  reasons: string[];
}

/**
 * HANDOFF 5.5: auto-confirm only when ALL hold. "Pharmacy open or accepted for next opening" is always
 * satisfied (an order placed while closed is accepted for the next opening), so it is not a blocker.
 * An empty delivery-area list cannot prove the address is inside, so delivery then waits for a human.
 */
export function autoConfirmDecision(input: AutoConfirmInput): AutoConfirmDecision {
  const reasons: string[] = [];
  const now = input.now ?? Date.now();
  if (!input.autoConfirmEnabled) reasons.push("auto_confirm_disabled");
  if (input.hasPrescription) reasons.push("prescription");
  if (input.items.length === 0) reasons.push("empty");
  for (const it of input.items) {
    if (it.saleClass !== "otc" || !it.classConfirmedAt) reasons.push("not_confirmed_otc");
    if (it.pharmacistRequired) reasons.push("pharmacist_required");
    if ((it.stockQty ?? 0) < it.qty) reasons.push("stock");
    const max = effectiveMaxQty(it, input.maxQtyDefault);
    if (max !== null && it.qty > max) reasons.push("qty_limit");
  }
  if (!input.sheetAsOf || now - input.sheetAsOf.getTime() > input.stockMaxAgeHours * 3600_000) reasons.push("stale_sheet");
  if (input.fulfillment === "delivery" && !addressInsideAreas(input.address, input.deliveryAreas)) reasons.push("outside_area");
  const unique = [...new Set(reasons)];
  return { auto: unique.length === 0, reasons: unique };
}

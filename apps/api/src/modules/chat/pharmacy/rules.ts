// Pharmacy hard rules, as pure functions (HANDOFF 5.2 / 5.5). The class always comes from the
// database row, never from the model or the visitor's text.

import { fold } from "./text";
import type { AddressSnapshot, DeliveryArea, OpeningHoursEntry, PharmacySettingsView, ProductRow } from "./types";

export type ProductGate =
  /** Confirmed OTC, orderable in chat (stock/qty are checked separately). */
  | { kind: "otc" }
  /** Confirmed prescription class: needs an uploaded prescription, always pending_pharmacist. */
  | { kind: "prescription" }
  /** Controlled: availability and price only. Never in a cart. */
  | { kind: "controlled" }
  /** Unclassified (or class proposed but not confirmed): treated like "pharmacist required, no online order". */
  | { kind: "unclassified" }
  /** Confirmed OTC that the pharmacy flagged as always needing the pharmacist. */
  | { kind: "pharmacist_required" }
  | { kind: "inactive" };

/** A class only counts when the pharmacy confirmed it. */
export function gateForProduct(p: Pick<ProductRow, "saleClass" | "classConfirmedAt" | "pharmacistRequired" | "active">): ProductGate {
  if (!p.active) return { kind: "inactive" };
  switch (p.saleClass) {
    case "controlled":
      // Controlled is blocked even when unconfirmed: the safe direction is always "do not sell".
      return { kind: "controlled" };
    case "otc":
      if (!p.classConfirmedAt) return { kind: "unclassified" };
      return p.pharmacistRequired ? { kind: "pharmacist_required" } : { kind: "otc" };
    case "prescription":
      return p.classConfirmedAt ? { kind: "prescription" } : { kind: "unclassified" };
    case "unclassified":
    default:
      return { kind: "unclassified" };
  }
}

const SANITY_MAX_QTY = 10;

export function effectiveMaxQty(p: Pick<ProductRow, "maxQtyPerOrder">, settings: Pick<PharmacySettingsView, "maxQtyPerItemDefault">): number {
  return p.maxQtyPerOrder ?? settings.maxQtyPerItemDefault ?? SANITY_MAX_QTY;
}

export function inStock(p: Pick<ProductRow, "stockQty">, qty = 1): boolean {
  return p.stockQty !== null && p.stockQty !== undefined && p.stockQty >= qty;
}

export function sheetAgeHours(stockAsOf: Date | null | undefined, now: Date = new Date()): number | null {
  if (!stockAsOf) return null;
  return Math.max(0, (now.getTime() - stockAsOf.getTime()) / 3_600_000);
}

/** The oldest stockAsOf among the given products; unknown (null) counts as stale. */
export function isSheetStale(products: Pick<ProductRow, "stockAsOf">[], maxAgeHours: number, now: Date = new Date()): boolean {
  if (products.length === 0) return false;
  return products.some((p) => {
    const age = sheetAgeHours(p.stockAsOf, now);
    return age === null || age > maxAgeHours;
  });
}

export function isInsideDeliveryArea(areas: DeliveryArea[], address: Pick<AddressSnapshot, "cep" | "district">): boolean {
  if (!areas || areas.length === 0) return true; // no restriction configured
  const cep = address.cep.replace(/\D/g, "");
  const district = fold(address.district);
  return areas.some((area) => {
    if (area.type === "cep_prefix") {
      const prefix = area.value.replace(/\D/g, "");
      return prefix.length > 0 && cep.startsWith(prefix);
    }
    if (area.type === "district") return fold(area.value) === district;
    return false;
  });
}

export interface AutoConfirmInput {
  items: { product: ProductRow; qty: number; viaEquivalentOf?: string }[];
  settings: PharmacySettingsView;
  fulfillment: "delivery" | "pickup";
  address?: Pick<AddressSnapshot, "cep" | "district"> | null;
  hasPrescription: boolean;
  requirePharmacist?: boolean;
  now?: Date;
}

export interface AutoConfirmDecision {
  autoConfirm: boolean;
  /** Machine-readable reasons it did NOT auto-confirm. */
  reasons: string[];
  staleSheet: boolean;
}

/** HANDOFF 5.5: auto-confirm only when ALL conditions hold. */
export function autoConfirmDecision(input: AutoConfirmInput): AutoConfirmDecision {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const stale = isSheetStale(input.items.map((i) => i.product), input.settings.stockMaxAgeHours, now);
  if (!input.settings.autoConfirmEnabled) reasons.push("auto_confirm_disabled");
  if (input.hasPrescription) reasons.push("prescription");
  if (input.requirePharmacist) reasons.push("pharmacist_requested");
  if (stale) reasons.push("stale_sheet");
  for (const { product, qty, viaEquivalentOf } of input.items) {
    const gate = gateForProduct(product);
    if (gate.kind !== "otc") reasons.push(`class_${gate.kind}`);
    if (!inStock(product, qty)) reasons.push("insufficient_stock");
    if (qty > effectiveMaxQty(product, input.settings)) reasons.push("qty_over_limit");
    if (viaEquivalentOf) reasons.push("equivalent_swap");
  }
  if (input.fulfillment === "delivery") {
    if (!input.address || !isInsideDeliveryArea(input.settings.deliveryAreas, input.address)) reasons.push("outside_area");
  }
  const unique = [...new Set(reasons)];
  return { autoConfirm: unique.length === 0, reasons: unique, staleSheet: stale };
}

/** Hard rule used both by the chat and by the order port: which lines may be in an order at all. */
export function canEnterOrder(product: ProductRow, hasPrescription: boolean): { ok: true } | { ok: false; reason: string } {
  const gate = gateForProduct(product);
  if (gate.kind === "otc") return { ok: true };
  if (gate.kind === "prescription") return hasPrescription ? { ok: true } : { ok: false, reason: "prescription_required" };
  if (gate.kind === "pharmacist_required") return { ok: false, reason: "pharmacist_required" };
  return { ok: false, reason: gate.kind };
}

// ---------------------------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------------------------

function parseHm(value: string | undefined): number | null {
  const m = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** true/false when the configured hours say so, null when unknown (no hours configured). */
export function isOpenNow(hours: OpeningHoursEntry[], timezone: string, now: Date = new Date()): boolean | null {
  if (!hours || hours.length === 0) return null;
  let weekday: string;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    minutes = h * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  } catch {
    return null;
  }
  const key = weekday === "Sat" ? "saturday" : weekday === "Sun" ? "sunday" : "weekdays";
  const entry = hours.find((h) => h.key === key);
  if (!entry) return null;
  if (!entry.open) return false;
  const from = parseHm(entry.from);
  const to = parseHm(entry.to);
  if (from === null || to === null) return null;
  return minutes >= from && minutes < to;
}

export function describeOpeningHours(hours: OpeningHoursEntry[]): string | null {
  const lines = (hours ?? [])
    .filter((h) => h.label)
    .map((h) => (h.open ? `${h.label}: ${h.from ?? "?"} às ${h.to ?? "?"}` : `${h.label}: fechado`));
  return lines.length > 0 ? lines.join("; ") : null;
}

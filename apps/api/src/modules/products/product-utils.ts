import { classLabel, classWarning, CLASS_BADGE, type SaleClass } from "../pharmacy-common/labels";
import { fold } from "../pharmacy-common/format";
import { lookupReference } from "./class-reference";

/** Normalised name + presentation key: "DIPIRONA 500MG C/10" and "dipirona 500 mg c 10" collide on purpose. */
export function normalizeProductName(s: string | null | undefined): string {
  return fold(s).replace(/\b(\d+)\s+(mg|ml|g|mcg|ui|cp|cps|comp)\b/g, "$1$2");
}

export function digitsOnlyEan(ean: string | null | undefined): string | null {
  const d = (ean ?? "").replace(/\D/g, "");
  // 8 (EAN-8), 12 (UPC), 13 (EAN-13), 14 (GTIN-14). Spreadsheets often drop leading zeros of long numbers.
  return d.length >= 8 && d.length <= 14 ? d : null;
}

/** Product identity inside a business: EAN when present, else normalised name + presentation. */
export function dedupKeyFor(p: { ean?: string | null; name: string; presentation?: string | null }): string {
  const ean = digitsOnlyEan(p.ean);
  if (ean) return `ean:${ean}`;
  return `name:${normalizeProductName(p.name)}|${normalizeProductName(p.presentation)}`;
}

export type PlaceholderIcon = "pill" | "bottle" | "box";
export function placeholderIconFor(p: { name: string; presentation?: string | null }): PlaceholderIcon {
  const t = fold(`${p.presentation ?? ""} ${p.name}`);
  if (/\b(xarope|solucao|gotas|suspensao|frasco|spray|colirio|shampoo|locao|\d+\s?ml)\b/.test(t)) return "bottle";
  if (/\b(comprimidos?|comp|capsulas?|caps|cp|cps|drageas?|pastilhas?)\b/.test(t)) return "pill";
  return "box";
}

export function subtitleFor(p: { presentation?: string | null; manufacturer?: string | null }): string {
  return [p.presentation, p.manufacturer].filter((x) => x && x.trim()).join(" · ");
}

export interface ProductRow {
  id: string;
  name: string;
  presentation: string | null;
  manufacturer: string | null;
  ean: string | null;
  sku: string | null;
  activeIngredient: string | null;
  category: string | null;
  priceCents: number;
  stockQty: number | null;
  stockAsOf: Date | null;
  imageKey: string | null;
  saleClass: SaleClass;
  classProposed: SaleClass | null;
  classProposedBy: string | null;
  classProposedReason: string | null;
  classConfirmedAt: Date | null;
  classConfirmedBy: string | null;
  pharmacistRequired: boolean;
  maxQtyPerOrder: number | null;
  equivalentGroup: string | null;
  active: boolean;
  updatedAt: Date;
}

/** The ONLY definition of "can be bought in the chat": OTC, confirmed by a pharmacist, in stock, not flagged. */
export function isOrderable(p: Pick<ProductRow, "saleClass" | "classConfirmedAt" | "pharmacistRequired" | "active" | "stockQty">): boolean {
  return p.saleClass === "otc" && !!p.classConfirmedAt && !p.pharmacistRequired && p.active && (p.stockQty ?? 0) > 0;
}

/** A confirmed class proposed by a (re-)import that differs from the confirmed one needs a human look. */
export function needsReview(p: Pick<ProductRow, "saleClass" | "classProposed" | "classConfirmedAt">): boolean {
  return !!p.classConfirmedAt && !!p.classProposed && p.classProposed !== "unclassified" && p.classProposed !== p.saleClass;
}

export function productDto(p: ProductRow, confirmedByName?: string | null) {
  const confirmed = !!p.classConfirmedAt && p.saleClass !== "unclassified";
  return {
    id: p.id,
    name: p.name,
    presentation: p.presentation,
    manufacturer: p.manufacturer,
    subtitle: subtitleFor(p),
    ean: p.ean,
    sku: p.sku,
    activeIngredient: p.activeIngredient,
    category: p.category,
    priceCents: p.priceCents,
    stockQty: p.stockQty,
    stockAsOf: p.stockAsOf ? p.stockAsOf.toISOString() : null,
    saleClass: p.saleClass,
    classLabel: classLabel(p.saleClass, confirmed),
    classBadge: CLASS_BADGE[p.saleClass],
    classProposed: p.classProposed,
    classProposedBy: p.classProposedBy,
    classProposedReason: p.classProposedReason,
    classConfirmedAt: p.classConfirmedAt ? p.classConfirmedAt.toISOString() : null,
    classConfirmedByName: confirmedByName ?? null,
    needsReview: needsReview(p),
    pharmacistRequired: p.pharmacistRequired,
    maxQtyPerOrder: p.maxQtyPerOrder,
    equivalentGroup: p.equivalentGroup,
    imageUrl: p.imageKey ? `/api/public/products/${p.id}/image?v=${p.updatedAt.getTime()}` : null,
    placeholderIcon: placeholderIconFor(p),
    orderable: isOrderable(p),
    warning: classWarning(p.saleClass),
    active: p.active,
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Class proposal (docs/pharmacy/API.md 6.2): explicit sheet column, then the bundled reference
// list, then the model. A proposal is NEVER the product's class: only a pharmacist confirms.

export interface ClassProposal {
  class: SaleClass;
  by: "sheet" | "reference" | "ai";
  /** Shown in the UI as "por ...": coluna "Tarja", lista Portaria 344, IA, IA, baixa confiança. */
  reason: string;
}

/** Maps a spreadsheet "class/tarja" cell to a class; null when the text is not recognised (never guess). */
export function parseClassCell(cell: unknown): SaleClass | null {
  const t = fold(typeof cell === "string" || typeof cell === "number" ? String(cell) : "");
  if (!t) return null;
  if (/\b(preta|controlad[oa]s?|portaria 344|[abc][123]|lista [abc]|especial|psicotropic[oa]s?|entorpecente)\b/.test(t) || /^[abc]\d$/.test(t)) return "controlled";
  if (/\b(vermelha|receita|prescricao|prescrito|retencao|sob prescricao|tarja vermelha|rx)\b/.test(t)) return "prescription";
  if (/\b(livre|venda livre|otc|mip|isento|sem tarja|sem receita|nao controlad[oa]|generico livre)\b/.test(t)) return "otc";
  return null;
}

const STRICTNESS: Record<SaleClass, number> = { unclassified: 0, otc: 1, prescription: 2, controlled: 3 };

/**
 * Order: explicit class column, then reference list, then model. Safety exception (documented):
 * a substance the reference list says is CONTROLLED always wins over a less restrictive sheet value,
 * because proposing OTC for a controlled drug is the one harmful error.
 */
export function proposeClass(input: {
  name: string;
  activeIngredient?: string | null;
  classCell?: unknown;
  /** Header of the class column, quoted in the reason: coluna "Tarja". */
  classColumnName?: string;
  model?: { class: SaleClass; confidence: "high" | "medium" | "low" } | null;
}): ClassProposal | null {
  const fromSheet = parseClassCell(input.classCell);
  const ref = lookupReference(input.name, input.activeIngredient);
  if (fromSheet) {
    if (ref?.class === "controlled" && STRICTNESS[fromSheet] < STRICTNESS.controlled) {
      return { class: "controlled", by: "reference", reason: ref.reason };
    }
    return { class: fromSheet, by: "sheet", reason: `coluna "${input.classColumnName ?? "Tarja"}"` };
  }
  if (ref) return { class: ref.class, by: "reference", reason: ref.reason };
  if (input.model && input.model.class !== "unclassified") {
    return { class: input.model.class, by: "ai", reason: input.model.confidence === "high" ? "IA" : "IA, baixa confiança" };
  }
  return null;
}

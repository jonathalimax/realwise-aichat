// Builders for the UI payloads (Message.uiData) exactly as docs/pharmacy/API.md 8.2 defines them.

import { fold } from "./text";
import { placeholderIconFor, productImageUrl } from "./catalog";
import { effectiveMaxQty, gateForProduct } from "./rules";
import type { CartDto, CartItemDto, CartLine, PharmacySettingsView, ProductRow, UiPayload } from "./types";

export function productCardUi(product: ProductRow, settings: PharmacySettingsView, qty = 1): UiPayload {
  return {
    type: "product_card",
    product: {
      id: product.id,
      name: product.name,
      presentation: product.presentation,
      priceCents: product.priceCents,
      inStock: (product.stockQty ?? 0) > 0,
      maxQty: effectiveMaxQty(product, settings),
      imageUrl: productImageUrl(product),
      placeholderIcon: placeholderIconFor(product),
    },
    qty,
  };
}

export const CATALOG_PAGE_SIZE = 8;
const MAX_CATEGORY_CHIPS = 6;

/** `catalog_list` payload (API.md 8.2): one page of the browsable rows plus category chips. Pure. */
export function catalogListUi(rows: ProductRow[], settings: PharmacySettingsView, opts: { category?: string | null; offset?: number; title?: string } = {}): UiPayload {
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of rows) {
    const label = r.category?.trim();
    if (!label) continue;
    const key = fold(label);
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { label, n: 1 });
  }
  const categories = [...counts.values()].sort((a, b) => b.n - a.n || fold(a.label).localeCompare(fold(b.label))).slice(0, MAX_CATEGORY_CHIPS).map((c) => c.label);
  const wanted = opts.category ? fold(opts.category) : "";
  const active = categories.find((c) => fold(c) === wanted) ?? null;
  const filtered = active ? rows.filter((r) => r.category && fold(r.category.trim()) === fold(active)) : rows;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const page = filtered.slice(offset, offset + CATALOG_PAGE_SIZE);
  const next = offset + CATALOG_PAGE_SIZE;
  return {
    type: "catalog_list",
    title: opts.title ?? (active ? active : "Nossos produtos"),
    categories,
    activeCategory: active,
    items: page.map((p) => ({
      id: p.id,
      name: p.name,
      presentation: p.presentation,
      priceCents: p.priceCents,
      inStock: true,
      maxQty: effectiveMaxQty(p, settings),
      imageUrl: productImageUrl(p),
      placeholderIcon: placeholderIconFor(p),
      requiresPrescription: gateForProduct(p).kind === "prescription",
    })),
    offset,
    total: filtered.length,
    nextOffset: next < filtered.length ? next : null,
  };
}

export type SuggestionItemReason = "out_of_stock" | "not_online" | "needs_pharmacist" | "unavailable";

/** One row of a `pharmacist_suggestion` card with LIVE price/stock/class (the class always comes from the DB row). */
export function suggestionItem(p: ProductRow, settings: PharmacySettingsView) {
  const gate = gateForProduct(p).kind;
  let reason: SuggestionItemReason | null = null;
  if (gate === "controlled" || gate === "unclassified") reason = "not_online";
  else if (gate === "pharmacist_required") reason = "needs_pharmacist";
  else if (gate === "inactive") reason = "unavailable";
  else if (!((p.stockQty ?? 0) > 0)) reason = "out_of_stock";
  return {
    productId: p.id,
    name: p.name,
    presentation: p.presentation,
    priceCents: p.priceCents,
    inStock: (p.stockQty ?? 0) > 0,
    maxQty: effectiveMaxQty(p, settings),
    imageUrl: productImageUrl(p),
    placeholderIcon: placeholderIconFor(p),
    requiresPrescription: gate === "prescription",
    sellable: reason === null,
    unavailableReason: reason,
  };
}

/** The `pharmacist_suggestion` payload with items refreshed from the DB (order kept, deleted products dropped). */
export function suggestionUi(base: { from?: unknown; note?: unknown }, products: ProductRow[], orderedIds: string[], settings: PharmacySettingsView): UiPayload {
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = orderedIds.map((id) => byId.get(id)).filter((p): p is ProductRow => Boolean(p)).map((p) => suggestionItem(p, settings));
  return { type: "pharmacist_suggestion", from: base.from ?? null, ...(typeof base.note === "string" && base.note ? { note: base.note } : {}), items };
}

export function buildCartDto(lines: CartLine[], products: ProductRow[], settings?: PharmacySettingsView): CartDto {
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: CartItemDto[] = [];
  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p) continue;
    items.push({
      productId: p.id,
      name: p.presentation ? `${p.name} · ${p.presentation}` : p.name,
      qty: line.qty,
      unitPriceCents: p.priceCents,
      lineTotalCents: p.priceCents * line.qty,
      imageUrl: productImageUrl(p),
      ...(settings ? { maxQty: effectiveMaxQty(p, settings) } : {}),
    });
  }
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.qty, 0),
    subtotalCents: items.reduce((n, i) => n + i.lineTotalCents, 0),
    requiresPrescription: lines.some((l) => byId.get(l.productId) && gateForProduct(byId.get(l.productId)!).kind === "prescription"),
  };
}

export function cartUi(cart: CartDto): UiPayload {
  return { type: "cart", cart };
}

// Builders for the UI payloads (Message.uiData) exactly as docs/pharmacy/API.md 8.2 defines them.

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

export function buildCartDto(lines: CartLine[], products: ProductRow[]): CartDto {
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

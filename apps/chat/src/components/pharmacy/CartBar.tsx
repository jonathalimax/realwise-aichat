"use client";

import { useState } from "react";
import { formatBRL } from "./format";
import type { CartDto, PharmacyActionResult } from "./types";

// Sticky cart summary above the composer (S2 "Carrinho: 1 item · R$ 8,90 [Ver]"). Expands into a
// list with quantity steppers; "Finalizar" starts checkout while no checkout is in progress.
export function CartBar({
  cart,
  checkoutStarted,
  busy,
  onAction,
}: {
  cart: CartDto;
  checkoutStarted: boolean;
  busy: boolean;
  onAction: (action: { type: string; [key: string]: unknown }, echo?: string) => Promise<PharmacyActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = cart.itemCount;

  async function act(action: { type: string; [key: string]: unknown }, echo?: string) {
    setError(null);
    const res = await onAction(action, echo);
    if (!res.ok) setError(res.error ?? "Não consegui atualizar o carrinho.");
    return res;
  }

  return (
    <div className="flex-none border-t border-zinc-200 bg-white px-4 py-2" role="region" aria-label="Carrinho">
      {open && (
        <ul className="mb-2 flex max-h-44 flex-col gap-2 overflow-y-auto">
          {cart.items.map((it) => (
            <li key={it.productId} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              <span className="flex-none text-zinc-500">{formatBRL(it.lineTotalCents)}</span>
              <button type="button" className="ph-iconbtn" aria-label={`Menos uma unidade de ${it.name}`} disabled={busy || checkoutStarted} onClick={() => act({ type: "cart.set_qty", productId: it.productId, qty: it.qty - 1 })}>
                −
              </button>
              <span className="w-5 text-center font-bold" aria-label={`Quantidade: ${it.qty}`}>
                {it.qty}
              </span>
              <button type="button" className="ph-iconbtn" aria-label={`Mais uma unidade de ${it.name}`} disabled={busy || checkoutStarted} onClick={() => act({ type: "cart.set_qty", productId: it.productId, qty: it.qty + 1 })}>
                +
              </button>
              <button type="button" className="ph-iconbtn" aria-label={`Remover ${it.name}`} disabled={busy || checkoutStarted} onClick={() => act({ type: "cart.remove", productId: it.productId })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mb-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            Carrinho: {count} {count === 1 ? "item" : "itens"}
          </span>{" "}
          · {formatBRL(cart.subtotalCents)}
          {cart.requiresPrescription && <span className="block text-xs text-zinc-500">Inclui item com receita.</span>}
        </div>
        <button type="button" className="ph-link min-h-[44px] min-w-[44px] px-2 text-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Fechar" : "Ver"}
        </button>
        {!checkoutStarted && (
          <button type="button" className="ph-btn" disabled={busy} onClick={() => act({ type: "checkout.start" }, "Finalizar pedido")}>
            Finalizar
          </button>
        )}
      </div>
    </div>
  );
}

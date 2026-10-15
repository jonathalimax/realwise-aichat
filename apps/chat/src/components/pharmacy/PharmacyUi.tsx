"use client";

import { Component, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { maskBrPhone, digitsOnly } from "@realwise/shared";
import { lookupCep, lookupCustomerPhone, resolveApiAsset, uploadPrescription, apiErrorMessage } from "../../lib/api";
import { formatBRL, maskCep, safeLink } from "./format";
import type { ConsentCardData, MaskedAddress, PharmacyActionResult, PharmacyUiContext, PharmacyUiPayload } from "./types";

// ------------------------------------------------------------------------------------------
// Renderer registry. One renderer per `ui.type` (docs/pharmacy/API.md 8.2). A payload whose type
// is unknown, or whose renderer throws, renders nothing: the message text above it (always
// persisted in Message.content) remains as the plain-text fallback.
// ------------------------------------------------------------------------------------------

export const PHARMACY_UI_KINDS = [
  "product_card",
  "catalog_list",
  "cart",
  "symptom_question",
  "red_flag",
  "controlled_info",
  "contact_capture",
  "address_capture",
  "fulfillment_choice",
  "order_review",
  "order_confirmation",
  "rx_upload",
  "pharmacist_suggestion",
  "human_joined",
] as const;

class UiBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Steps of a guided flow whose next control should take the keyboard focus when the card appears right after the
// previous step was submitted (the submitted control is disabled, so focus would otherwise fall back to the page top).
const FOCUS_NEXT_KINDS = new Set(["fulfillment_choice", "order_review", "address_capture", "symptom_question"]);

export function PharmacyUi({ ui, ctx }: { ui: PharmacyUiPayload | null | undefined; ctx: PharmacyUiContext }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const kind = ui && typeof ui === "object" ? ui.type : undefined;
  const interactive = ctx.interactive;
  useEffect(() => {
    if (!interactive || !visitorInteracted || !kind || !FOCUS_NEXT_KINDS.has(kind)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return; // never steal focus from the composer or a field being filled
    const target = rootRef.current?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), [href]");
    target?.focus();
  }, [interactive, kind]);
  if (!ui || typeof ui !== "object" || typeof ui.type !== "string") return null;
  if (!(PHARMACY_UI_KINDS as readonly string[]).includes(ui.type) || ui.type === "human_joined") return null;
  return (
    <UiBoundary>
      <div ref={rootRef} className="mt-2 w-full max-w-[22rem]">
        {renderKind(ui, ctx)}
      </div>
    </UiBoundary>
  );
}

function renderKind(ui: PharmacyUiPayload, ctx: PharmacyUiContext): ReactNode {
  switch (ui.type) {
    case "product_card":
      return ui.product ? <ProductCard ui={ui} ctx={ctx} /> : null;
    case "catalog_list":
      return Array.isArray(ui.items) && ui.items.length > 0 ? <CatalogList ui={ui} ctx={ctx} /> : null;
    case "cart":
      return ui.cart ? <CartSummaryCard cart={ui.cart} ctx={ctx} /> : null;
    case "pharmacist_suggestion":
      return Array.isArray(ui.items) && ui.items.length > 0 ? <PharmacistSuggestion ui={ui} ctx={ctx} /> : null;
    case "symptom_question":
      return <SymptomQuestion ui={ui} ctx={ctx} />;
    case "red_flag":
      return <RedFlagCard ui={ui} ctx={ctx} />;
    case "controlled_info":
      return ui.product ? <ControlledInfoCard ui={ui} ctx={ctx} /> : null;
    case "contact_capture":
      return <ContactCapture ui={ui} ctx={ctx} />;
    case "address_capture":
      return <AddressCapture ui={ui} ctx={ctx} />;
    case "fulfillment_choice":
      return Array.isArray(ui.options) ? <FulfillmentChoice ui={ui} ctx={ctx} /> : null;
    case "order_review":
      return <OrderReview ui={ui} ctx={ctx} />;
    case "order_confirmation":
      return <OrderConfirmation ui={ui} />;
    case "rx_upload":
      return <RxUpload ui={ui} ctx={ctx} />;
    case "human_joined":
      // Rendered as a banner by the message list (kind = human_joined); nothing extra here.
      return null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------
// Shared bits
// ------------------------------------------------------------------------------------------

function PlaceholderIcon({ kind }: { kind?: string }) {
  const common = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "bottle")
    return (
      <svg {...common}>
        <path d="M9 3h6v3H9zM8 6h8l1 3v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9z" />
        <path d="M7 13h10" />
      </svg>
    );
  if (kind === "box")
    return (
      <svg {...common}>
        <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
        <path d="M3 8l9 5 9-5M12 13v8" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M10.5 20.5l10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7zM8.5 8.5l7 7" />
    </svg>
  );
}

function Thumb({ imageUrl, icon, alt }: { imageUrl?: string | null; icon?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const src = resolveApiAsset(imageUrl);
  return (
    <span className="ph-thumb">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <PlaceholderIcon kind={icon} />
      )}
    </span>
  );
}

// Wraps a card action: pending flag + inline error, never throws.
// Keyboard and screen-reader users: when a new live card appears AFTER the visitor started interacting (never on the
// first paint or a refresh, so no keyboard pops up by itself), focus moves to its first field.
let visitorInteracted = false;
if (typeof window !== "undefined") {
  const mark = () => {
    visitorInteracted = true;
  };
  window.addEventListener("pointerdown", mark, { once: true, capture: true });
  window.addEventListener("keydown", mark, { once: true, capture: true });
}
function useFocusWhen(elementId: string, when: boolean) {
  useEffect(() => {
    if (!when || !visitorInteracted) return;
    const el = document.getElementById(elementId);
    if (el && !(el as HTMLInputElement).disabled) el.focus({ preventScroll: false });
  }, [elementId, when]);
}

function useCardAction(ctx: PharmacyUiContext) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function run(action: { type: string; [key: string]: unknown }, echo?: string): Promise<PharmacyActionResult> {
    setPending(true);
    setError(null);
    const result = await ctx.onAction(action, echo);
    setPending(false);
    if (result.ok) setDone(true);
    else setError(result.error ?? "Não consegui concluir agora. Tente de novo em instantes.");
    return result;
  }
  return { pending, error, done, run, setError };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-red-700">
      {message}
    </p>
  );
}

// One tap: the notice is shown as text and the button that follows IS the consent (no checkbox).
function ConsentNotice({ consent }: { consent: ConsentCardData }) {
  return <p className="text-[13px] leading-snug text-zinc-800">{consent.text}</p>;
}

// ------------------------------------------------------------------------------------------
// Product card (S2)
// ------------------------------------------------------------------------------------------

function ProductCard({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const p = ui.product;
  const maxQty = Math.max(1, Number(p.maxQty) || 5);
  const [qty, setQty] = useState<number>(Math.min(Math.max(1, Number(ui.qty) || 1), maxQty));
  const { pending, error, done, run } = useCardAction(ctx);
  const inStock = p.inStock !== false;
  const disabled = !inStock || pending || ctx.busy;
  return (
    <div className="ph-card p-3.5">
      <div className="flex items-center gap-2.5">
        <Thumb imageUrl={p.imageUrl} icon={p.placeholderIcon} alt={p.name} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900">{p.name}</div>
          {p.presentation && <div className="text-xs text-zinc-500">{p.presentation}</div>}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-lg font-bold text-zinc-900">{formatBRL(p.priceCents)}</span>
        {inStock ? <span className="ph-badge ph-badge-green">✓ em estoque</span> : <span className="ph-badge ph-badge-amber">sem estoque</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" className="ph-iconbtn" aria-label={`Menos uma unidade de ${p.name}`} disabled={!inStock || qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>
          −
        </button>
        <span className="w-7 text-center text-sm font-bold" aria-live="polite" aria-label={`Quantidade: ${qty}`}>
          {qty}
        </span>
        <button type="button" className="ph-iconbtn" aria-label={`Mais uma unidade de ${p.name}`} disabled={!inStock || qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>
          +
        </button>
        <button type="button" className="ph-btn ml-auto" disabled={disabled} onClick={() => run({ type: "cart.add", productId: p.id, qty })}>
          {done && !pending ? "Adicionado ✓" : pending ? "Adicionando…" : "Adicionar"}
        </button>
      </div>
      {qty >= maxQty && inStock && <p className="mt-1.5 text-xs text-zinc-500">Máximo de {maxQty} por pedido.</p>}
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Catalog list: what the pharmacy has (compact rows, price right-aligned). Only the newest list is live.
// ------------------------------------------------------------------------------------------

function CatalogList({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const items: any[] = ui.items.filter((it: any) => it && typeof it.id === "string" && typeof it.name === "string");
  const categories: string[] = Array.isArray(ui.categories) ? ui.categories.filter((c: unknown) => typeof c === "string") : [];
  const active: string | null = typeof ui.activeCategory === "string" ? ui.activeCategory : null;
  const { pending, error, run } = useCardAction(ctx);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const locked = !ctx.interactive || ctx.busy || pending;
  const nextOffset = typeof ui.nextOffset === "number" ? ui.nextOffset : null;
  async function add(it: any) {
    const res = await run({ type: "cart.add", productId: it.id, qty: 1 }, `Adicionar ${it.name}`);
    if (res.ok) setAdded((a) => ({ ...a, [it.id]: true }));
  }
  return (
    <div className="ph-card p-3" role="group" aria-label={typeof ui.title === "string" ? ui.title : "Produtos"}>
      {typeof ui.title === "string" && <div className="mb-2 text-sm font-semibold text-zinc-900">{ui.title}</div>}
      {categories.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Categorias">
          <button type="button" className="ph-chip" aria-pressed={!active} disabled={locked} style={!active ? { background: "var(--ph-soft)" } : undefined} onClick={() => run({ type: "catalog.browse" }, "Todos")}>
            Todos
          </button>
          {categories.map((c) => (
            <button key={c} type="button" className="ph-chip" aria-pressed={active === c} disabled={locked} style={active === c ? { background: "var(--ph-soft)" } : undefined} onClick={() => run({ type: "catalog.browse", category: c }, c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <ul className="m-0 flex list-none flex-col divide-y divide-zinc-100 p-0">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2.5 py-2">
            <Thumb imageUrl={it.imageUrl} icon={it.placeholderIcon} alt="" />
            <button
              type="button"
              className="min-h-[44px] min-w-0 flex-1 bg-transparent p-0 text-left"
              disabled={locked}
              aria-label={`Ver ${it.name}${it.presentation ? `, ${it.presentation}` : ""}`}
              onClick={() => run({ type: "product.view", productId: it.id }, `Ver ${it.name}`)}
            >
              <span className="block text-sm font-semibold leading-tight text-zinc-900 break-words">{it.name}</span>
              {it.presentation && <span className="block text-xs text-zinc-500 break-words">{it.presentation}</span>}
              {it.requiresPrescription && <span className="ph-badge ph-badge-amber mt-0.5">Exige receita</span>}
            </button>
            <div className="flex flex-none flex-col items-end gap-1">
              <span className="text-sm font-bold text-zinc-900">{formatBRL(it.priceCents)}</span>
              <button type="button" className="ph-btn !min-h-[44px] !px-3" disabled={locked || it.inStock === false} aria-label={`Adicionar ${it.name} ao carrinho`} onClick={() => add(it)}>
                {added[it.id] ? "Adicionado ✓" : "Adicionar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {nextOffset !== null && (
        <button type="button" className="ph-btn ph-btn-outline mt-2 w-full" disabled={locked} onClick={() => run({ type: "catalog.browse", ...(active ? { category: active } : {}), offset: nextOffset }, "Ver mais")}>
          Ver mais
        </button>
      )}
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Cart summary (read-only snapshot in the thread; the live cart is in the cart bar)
// ------------------------------------------------------------------------------------------

function CartSummaryCard({ cart, ctx }: { cart: any; ctx: PharmacyUiContext }) {
  const items: any[] = Array.isArray(cart.items) ? cart.items : [];
  const { pending, error, run } = useCardAction(ctx);
  // Only the newest cart card is live (older snapshots are read-only history).
  const locked = !ctx.interactive || ctx.busy || pending;
  return (
    <div className="ph-card p-3.5">
      <div className="text-sm font-semibold">Seu carrinho</div>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">Carrinho vazio.</p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {items.map((it) => {
            const max = Math.max(1, Number(it.maxQty) || 99);
            return (
              <li key={it.productId} className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{it.name}</span>
                  <span className="flex-none">{formatBRL(it.lineTotalCents)}</span>
                </div>
                {ctx.interactive && (
                  <div className="flex items-center gap-2">
                    <button type="button" className="ph-iconbtn" aria-label={`Menos uma unidade de ${it.name}`} disabled={locked || it.qty <= 1} onClick={() => run({ type: "cart.set_qty", productId: it.productId, qty: it.qty - 1 })}>
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-bold" aria-label={`Quantidade: ${it.qty}`}>
                      {it.qty}
                    </span>
                    <button type="button" className="ph-iconbtn" aria-label={`Mais uma unidade de ${it.name}`} disabled={locked || it.qty >= max} onClick={() => run({ type: "cart.set_qty", productId: it.productId, qty: it.qty + 1 })}>
                      +
                    </button>
                    <button type="button" className="ph-link ml-auto min-h-[44px] text-sm" disabled={locked} aria-label={`Remover ${it.name} do carrinho`} onClick={() => run({ type: "cart.remove", productId: it.productId })}>
                      Remover
                    </button>
                  </div>
                )}
                {!ctx.interactive && <span className="text-xs text-zinc-500">{it.qty}×</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex justify-between border-t border-zinc-200 pt-2 text-sm font-bold">
        <span>Subtotal</span>
        <span>{formatBRL(cart.subtotalCents)}</span>
      </div>
      {cart.requiresPrescription && <p className="mt-2 text-xs text-zinc-600">Há item que exige receita. O pedido passa pelo farmacêutico.</p>}
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Pharmacist suggestion: what the pharmacist indicated, bought with one tap (live price/stock from the server)
// ------------------------------------------------------------------------------------------

function PharmacistSuggestion({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const items: any[] = ui.items.filter((it: any) => it && typeof it.productId === "string" && typeof it.name === "string");
  const from = ui.from && typeof ui.from.name === "string" ? ui.from : null;
  const note = typeof ui.note === "string" && ui.note.trim() ? ui.note.trim() : null;
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const { pending, error, run } = useCardAction(ctx);
  // Only the newest suggestion card is live; older ones stay readable.
  const locked = !ctx.interactive || ctx.busy || pending;
  const sellable = (it: any) => (typeof it.sellable === "boolean" ? it.sellable : it.inStock !== false);
  const qtyOf = (it: any) => Math.min(Math.max(1, qtys[it.productId] ?? 1), Math.max(1, Number(it.maxQty) || 5));
  const buyable = items.filter(sellable);
  async function addOne(it: any) {
    const res = await run({ type: "cart.add", productId: it.productId, qty: qtyOf(it) }, `Adicionar ${it.name}`);
    if (res.ok) setAdded((a) => ({ ...a, [it.productId]: true }));
  }
  async function addAll() {
    const res = await run({ type: "cart.add_many", items: buyable.map((it) => ({ productId: it.productId, qty: qtyOf(it) })) }, "Adicionar tudo ao carrinho");
    if (res.ok) setAdded(Object.fromEntries(buyable.map((it) => [it.productId, true])));
  }
  return (
    <div className="ph-card p-3" role="group" aria-label="Indicação do farmacêutico">
      {from && (
        <div className="mb-1 text-sm font-semibold text-zinc-900">
          Indicado por {from.name}
          {from.roleName ? ` · ${from.roleName}` : ""}
        </div>
      )}
      {note && <p className="mb-2 text-xs text-zinc-600">{note}</p>}
      <ul className="m-0 flex list-none flex-col divide-y divide-zinc-100 p-0">
        {items.map((it) => {
          const can = sellable(it);
          const max = Math.max(1, Number(it.maxQty) || 5);
          const qty = qtyOf(it);
          return (
            <li key={it.productId} className="flex flex-col gap-2 py-2.5">
              <div className="flex items-center gap-2.5">
                <Thumb imageUrl={it.imageUrl} icon={it.placeholderIcon} alt="" />
                <div className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold leading-tight text-zinc-900">{it.name}</span>
                  {it.presentation && <span className="block break-words text-xs text-zinc-500">{it.presentation}</span>}
                  {it.requiresPrescription && <span className="ph-badge ph-badge-amber mt-0.5">Exige receita</span>}
                </div>
                <span className="flex-none text-sm font-bold text-zinc-900">{formatBRL(it.priceCents)}</span>
              </div>
              {can ? (
                <div className="flex items-center gap-2">
                  <button type="button" className="ph-iconbtn" aria-label={`Menos uma unidade de ${it.name}`} disabled={locked || qty <= 1} onClick={() => setQtys((q) => ({ ...q, [it.productId]: Math.max(1, qty - 1) }))}>
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-bold" aria-label={`Quantidade: ${qty}`}>
                    {qty}
                  </span>
                  <button type="button" className="ph-iconbtn" aria-label={`Mais uma unidade de ${it.name}`} disabled={locked || qty >= max} onClick={() => setQtys((q) => ({ ...q, [it.productId]: Math.min(max, qty + 1) }))}>
                    +
                  </button>
                  <button type="button" className="ph-btn ml-auto !min-h-[44px] !px-3" disabled={locked} aria-label={`Adicionar ${it.name} ao carrinho`} onClick={() => addOne(it)}>
                    {added[it.productId] ? "Adicionado ✓" : "Adicionar"}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button type="button" className="ph-btn ph-btn-outline !min-h-[44px] !px-3" disabled aria-disabled="true">
                    {it.unavailableReason === "out_of_stock" || it.inStock === false ? "Sem estoque" : "Indisponível online"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="ph-btn mt-2 w-full" disabled={locked || buyable.length === 0} onClick={addAll}>
        {pending ? "Adicionando…" : "Adicionar tudo ao carrinho"}
      </button>
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Symptom questionnaire (S3): one question per turn, chips + optional free text
// ------------------------------------------------------------------------------------------

function SymptomQuestion({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const chips: string[] = Array.isArray(ui.chips) ? ui.chips.filter((c: unknown) => typeof c === "string") : [];
  const consent: ConsentCardData | null = ui.consent && typeof ui.consent.text === "string" ? ui.consent : null;
  const [text, setText] = useState("");
  const { pending, error, run } = useCardAction(ctx);
  const [answered, setAnswered] = useState<string | null>(null);
  // Only the newest question is live: once answered, or once a newer question exists, its chips and field are gone.
  const live = ctx.interactive && !answered;
  const locked = !live || pending || ctx.busy;
  const inputId = useId();

  // Declining the health-data notice ("Só chamar o farmacêutico") needs no consent.
  const isDecline = (c: string) => /^s[óo] chamar o farmac/i.test(c.trim());

  async function answer(value: string) {
    if (!value.trim()) return;
    const payload: { type: string; [key: string]: unknown } = { type: "symptom.answer", step: ui.step, value: value.trim() };
    // First question: the notice is shown and tapping the agree button IS the consent (it travels with the answer).
    if (consent && !isDecline(value)) payload.consent = true;
    const result = await run(payload, value.trim());
    if (result.ok) setAnswered(value.trim());
  }

  if (!live) return null;
  return (
    <div className="flex flex-col gap-2">
      {consent && (
        <div className="ph-card p-3">
          <ConsentNotice consent={consent} />
        </div>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Respostas sugeridas">
          {chips.map((c) => (
            <button key={c} type="button" className="ph-chip" disabled={locked} onClick={() => answer(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {ui.allowFreeText !== false && !consent && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            answer(text);
          }}
        >
          <label htmlFor={inputId} className="ph-sr-only">
            Outra resposta
          </label>
          <input id={inputId} className="ph-input" placeholder="Outra resposta…" value={text} disabled={locked} onChange={(e) => setText(e.target.value)} maxLength={300} />
          <button type="submit" className="ph-btn" disabled={locked || !text.trim()}>
            Enviar
          </button>
        </form>
      )}
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Red flag (S4)
// ------------------------------------------------------------------------------------------

function RedFlagCard({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const samu = typeof ui.samuNumber === "string" && /^\d{2,4}$/.test(ui.samuNumber) ? ui.samuNumber : "192";
  const { pending, error, done, run } = useCardAction(ctx);
  const alreadyNotified = Boolean(ui.handoffId) || done;
  return (
    <div className="flex flex-col gap-2">
      <div role="alert" className="ph-alert ph-alert-red flex flex-col gap-1.5">
        <b className="text-sm">{ui.headline || "Isso pode ser urgente."}</b>
        <span>{ui.body || `Ligue ${samu} (SAMU) ou vá ao pronto-socorro agora.`}</span>
        <a href={`tel:${samu}`} className="ph-btn ph-btn-danger mt-1 w-fit no-underline">
          Ligar {samu} (SAMU)
        </a>
      </div>
      {ui.offerPharmacist !== false &&
        (alreadyNotified ? (
          <p className="text-sm font-medium text-zinc-700">✓ O farmacêutico foi avisado.</p>
        ) : (
          <div>
            <button type="button" className="ph-btn ph-btn-outline border-red-300 text-red-800" disabled={!ctx.interactive || pending || ctx.busy} onClick={() => run({ type: "handoff.request", reason: "symptom" }, "Avisar o farmacêutico")}>
              {pending ? "Avisando…" : "Avisar o farmacêutico"}
            </button>
          </div>
        ))}
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Controlled / restricted info (S5)
// ------------------------------------------------------------------------------------------

function ControlledInfoCard({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const p = ui.product;
  const { pending, done, error, run } = useCardAction(ctx);
  return (
    <div className="flex flex-col gap-2">
      <div className="ph-card flex flex-col gap-1.5 p-3.5">
        <b className="text-sm">
          {p.name}
          {p.presentation ? ` · ${p.presentation}` : ""}
        </b>
        <span className="text-sm">
          {ui.available ? "Temos em estoque" : "Sem estoque no momento"}
          {typeof ui.priceCents === "number" && ui.available ? (
            <>
              {" "}
              · <b>{formatBRL(ui.priceCents)}</b>
            </>
          ) : null}
        </span>
        <div className="ph-alert ph-alert-amber">{ui.message || "Este medicamento é controlado e não pode ser vendido online. Venha à farmácia com a receita."}</div>
      </div>
      <div>
        {done ? (
          <p className="text-sm font-medium text-zinc-700">✓ Pedido de contato enviado ao farmacêutico.</p>
        ) : (
          <button type="button" className="ph-chip" disabled={!ctx.interactive || pending || ctx.busy} onClick={() => run({ type: "handoff.request", reason: "other" }, "Falar com o farmacêutico")}>
            Falar com o farmacêutico
          </button>
        )}
      </div>
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Contact capture, phone-first, with returning-customer greeting (S6)
// ------------------------------------------------------------------------------------------

function ContactCapture({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const fields: string[] = Array.isArray(ui.fields) ? ui.fields : ["phone", "name", "email"];
  // The engine already has the phone (typed in chat): only the missing e-mail / consent is asked, never the phone again.
  if (!fields.includes("phone")) return <ContactFollowUp ui={ui} ctx={ctx} fields={fields} />;
  return <ContactCaptureFull ui={ui} ctx={ctx} />;
}

function ContactFollowUp({ ui, ctx, fields }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext; fields: string[] }) {
  const consent: ConsentCardData | null = ui.consent && typeof ui.consent.text === "string" ? ui.consent : null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { pending, error, done, run } = useCardAction(ctx);
  const nameId = useId();
  const emailId = useId();
  const live = ctx.interactive && !done;
  const locked = !live || pending || ctx.busy;
  const needsName = fields.includes("name");
  useFocusWhen(needsName ? nameId : emailId, live);
  async function submit() {
    if (needsName && !name.trim()) return;
    const payload: { type: string; [key: string]: unknown } = { type: "checkout.contact" };
    // The button IS the consent, but only when the notice is on the card (never claim a consent that was not shown).
    if (consent) payload.consent = true;
    if (name.trim()) payload.name = name.trim();
    if (email.trim()) payload.email = email.trim();
    await run(payload, name.trim() ? `Nome: ${name.trim()}` : email.trim() ? `E-mail: ${email.trim()}` : consent ? "Concordo" : "Continuar");
  }
  return (
    <form
      className="ph-card flex flex-col gap-2.5 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {needsName && (
        <div>
          <label htmlFor={nameId} className="ph-label">
            Seu nome
          </label>
          <input id={nameId} className="ph-input" autoComplete="given-name" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
      )}
      {fields.includes("email") && (
        <div>
          <label htmlFor={emailId} className="ph-label">
            E-mail (opcional)
          </label>
          <input id={emailId} className="ph-input" type="email" autoComplete="email" value={email} disabled={locked} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
        </div>
      )}
      {consent && <ConsentNotice consent={consent} />}
      <button type="submit" className="ph-btn" disabled={locked || (needsName && !name.trim())}>
        {pending ? "Enviando…" : consent ? "Concordo e quero continuar" : "Continuar"}
      </button>
      <ErrorLine message={error} />
    </form>
  );
}

function ContactCaptureFull({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const fields: string[] = Array.isArray(ui.fields) ? ui.fields : ["phone", "name", "email"];
  const consent: ConsentCardData | null = ui.consent && typeof ui.consent.text === "string" ? ui.consent : null;
  const initial = ui.recognized && typeof ui.recognized.firstName === "string" ? ui.recognized : null;
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [recognized, setRecognized] = useState<{ firstName: string; address: MaskedAddress | null } | null>(initial);
  const [step, setStep] = useState<"phone" | "details">(initial ? "details" : "phone");
  const [looking, setLooking] = useState(false);
  const { pending, error, done, run } = useCardAction(ctx);
  const phoneId = useId();
  const nameId = useId();
  const emailId = useId();
  const phoneOk = digitsOnly(phone).length === 10 || digitsOnly(phone).length === 11;
  const live = ctx.interactive && !done;
  const locked = !live || pending || ctx.busy;
  // A refresh in the middle of the form must not make the customer type the phone again: the draft lives in this tab's
  // sessionStorage (per conversation) until the card is submitted.
  const draftKey = ctx.conversationId ? `rw_ph_contact_draft_${ctx.conversationId}` : null;
  useEffect(() => {
    if (!draftKey || !ctx.interactive) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { phone?: string; name?: string; email?: string; step?: "phone" | "details"; recognized?: { firstName: string; address: MaskedAddress | null } | null };
      if (typeof d.phone === "string" && d.phone) setPhone(d.phone);
      if (typeof d.name === "string") setName(d.name);
      if (typeof d.email === "string") setEmail(d.email);
      if (d.recognized && typeof d.recognized.firstName === "string") setRecognized(d.recognized);
      if (d.step === "details") setStep("details");
    } catch {
      // storage unavailable: the form simply starts empty
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (done) sessionStorage.removeItem(draftKey);
      else if (ctx.interactive && phone) sessionStorage.setItem(draftKey, JSON.stringify({ phone, name, email, step, recognized }));
    } catch {
      // ignore
    }
  }, [draftKey, done, ctx.interactive, phone, name, email, step, recognized]);
  // A customer the pharmacy already knows (recognized by phone) gave the consent before: the notice is not shown again.
  const showConsent = consent && !recognized;
  useFocusWhen(phoneId, ctx.interactive && !done && step === "phone" && !initial);
  useFocusWhen(nameId, ctx.interactive && !done && step === "details" && !recognized);

  async function continueWithPhone() {
    if (!phoneOk || looking) return;
    setLooking(true);
    try {
      const res = await lookupCustomerPhone(ctx.businessId, phone);
      if (res.recognized && res.firstName) {
        setRecognized({ firstName: res.firstName, address: (res.address as MaskedAddress | null) ?? null });
        setName((n) => n || res.firstName!);
      }
    } catch {
      // Recognition is a convenience: any failure just continues as a new customer.
    } finally {
      setLooking(false);
      setStep("details");
    }
  }

  async function submit() {
    if (!phoneOk) return;
    // The submit button IS the consent when the notice is on the card.
    const payload: { type: string; [key: string]: unknown } = { type: "checkout.contact", phone, ...(showConsent ? { consent: true } : {}) };
    if (name.trim()) payload.name = name.trim();
    if (email.trim()) payload.email = email.trim();
    await run(payload, `WhatsApp: ${phone}`);
  }

  return (
    <form
      className="ph-card flex flex-col gap-2.5 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === "phone") continueWithPhone();
        else submit();
      }}
    >
      <div>
        <label htmlFor={phoneId} className="ph-label">
          WhatsApp (com DDD)
        </label>
        <input id={phoneId} className="ph-input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="(41) 99999-9999" value={phone} disabled={locked || step === "details"} onChange={(e) => setPhone(maskBrPhone(e.target.value))} />
      </div>

      {step === "phone" && (
        <button type="submit" className="ph-btn" disabled={locked || !phoneOk || looking}>
          {looking ? "Verificando…" : "Continuar"}
        </button>
      )}

      {step === "details" && (
        <>
          {recognized ? (
            <div className="ph-alert ph-alert-soft" aria-live="polite">
              <b>Oi, {recognized.firstName}!</b> Que bom ver você de novo.
              {recognized.address && (
                <>
                  <br />
                  Endereço salvo: <b>{recognized.address.label}</b>
                </>
              )}
              <br />
              <span className="text-xs">Por segurança, mostramos só parte do endereço. Você confirma na próxima etapa.</span>
            </div>
          ) : (
            <>
              {fields.includes("name") && (
                <div>
                  <label htmlFor={nameId} className="ph-label">
                    Seu nome
                  </label>
                  <input id={nameId} className="ph-input" autoComplete="given-name" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </div>
              )}
              {fields.includes("email") && (
                <div>
                  <label htmlFor={emailId} className="ph-label">
                    E-mail (opcional)
                  </label>
                  <input id={emailId} className="ph-input" type="email" autoComplete="email" value={email} disabled={locked} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
                </div>
              )}
            </>
          )}
          {showConsent && consent && <ConsentNotice consent={consent} />}
          <div className="flex gap-2">
            <button type="button" className="ph-btn ph-btn-outline" disabled={locked} onClick={() => { setStep("phone"); setRecognized(null); }}>
              Trocar número
            </button>
            <button type="submit" className="ph-btn flex-1" disabled={locked || !phoneOk}>
              {pending ? "Enviando…" : showConsent ? "Concordo e continuar" : "Continuar"}
            </button>
          </div>
        </>
      )}
      <ErrorLine message={error} />
    </form>
  );
}

// ------------------------------------------------------------------------------------------
// Address capture (S7): CEP lookup, number with "sem número", complement, reference
// ------------------------------------------------------------------------------------------

type CepState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; street: string; district: string; city: string; state: string }
  | { status: "manual"; reason: "not_found" | "unavailable" | "generic" };

function AddressCapture({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const saved: MaskedAddress | null = ui.saved && typeof ui.saved.label === "string" ? ui.saved : null;
  const [mode, setMode] = useState<"confirm" | "form">(saved && ui.askConfirmSaved !== false ? "confirm" : "form");
  const [replaceDefault, setReplaceDefault] = useState(false);
  const [cep, setCep] = useState("");
  const [cepState, setCepState] = useState<CepState>({ status: "idle" });
  const [number, setNumber] = useState("");
  const [noNumber, setNoNumber] = useState(false);
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [street, setStreet] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [uf, setUf] = useState("");
  const { pending, error, done, run } = useCardAction(ctx);
  const ids = { cep: useId(), num: useId(), comp: useId(), ref: useId(), street: useId(), district: useId(), city: useId(), uf: useId() };
  const live = ctx.interactive && !done;
  const locked = !live || pending || ctx.busy;
  const lookupSeq = useRef(0);
  useFocusWhen(ids.cep, live && mode === "form");

  useEffect(() => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) {
      setCepState({ status: "idle" });
      return;
    }
    const seq = ++lookupSeq.current;
    setCepState({ status: "loading" });
    lookupCep(ctx.businessId, digits)
      .then((res) => {
        if (seq !== lookupSeq.current) return;
        if (res.status === "ok") {
          if (!res.street) {
            // Generic CEP (city-wide): the provider has no street, so the visitor types it.
            setDistrict(res.district ?? "");
            setCity(res.city ?? "");
            setUf(res.state ?? "");
            setCepState({ status: "manual", reason: "generic" });
          } else {
            setCepState({ status: "ok", street: res.street, district: res.district ?? "", city: res.city ?? "", state: res.state ?? "" });
          }
        } else {
          setCepState({ status: "manual", reason: res.status === "not_found" ? "not_found" : "unavailable" });
        }
      })
      .catch(() => {
        if (seq !== lookupSeq.current) return;
        setCepState({ status: "manual", reason: "unavailable" });
      });
  }, [cep, ctx.businessId]);

  const manual = cepState.status === "manual";
  const numberValue = noNumber ? "S/N" : number.trim();
  const canSubmit =
    cep.replace(/\D/g, "").length === 8 &&
    Boolean(numberValue) &&
    (cepState.status === "ok" || (manual && street.trim().length > 0 && city.trim().length > 0 && uf.trim().length === 2));

  async function submit() {
    if (!canSubmit) return;
    const payload: { type: string; [key: string]: unknown } = {
      type: "checkout.address",
      cep: maskCep(cep),
      number: numberValue,
      complement: complement.trim() || null,
      reference: reference.trim() || null,
      replaceDefault,
    };
    if (manual) {
      payload.street = street.trim();
      payload.district = district.trim() || null;
      payload.city = city.trim();
      payload.state = uf.trim().toUpperCase();
    }
    await run(payload, `CEP ${maskCep(cep)}, ${numberValue}`);
  }

  if (mode === "confirm" && saved) {
    return (
      <div className="ph-card flex flex-col gap-2.5 p-3.5">
        <div className="text-sm">
          Confirma seu endereço?
          <br />
          <b>{saved.label}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ph-chip" disabled={locked} onClick={() => run({ type: "checkout.use_saved_address", addressId: saved.id }, "Está certo")}>
            Está certo
          </button>
          <button
            type="button"
            className="ph-chip"
            disabled={locked}
            onClick={() => {
              setReplaceDefault(true);
              setMode("form");
            }}
          >
            Atualizar endereço
          </button>
          <button
            type="button"
            className="ph-chip"
            disabled={locked}
            onClick={() => {
              setReplaceDefault(false);
              setMode("form");
            }}
          >
            Entregar em outro endereço
          </button>
        </div>
        <ErrorLine message={error} />
      </div>
    );
  }

  return (
    <form
      className="ph-card flex flex-col gap-2.5 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label htmlFor={ids.cep} className="ph-label">
          CEP
        </label>
        <input id={ids.cep} className="ph-input" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cep} disabled={locked} onChange={(e) => setCep(maskCep(e.target.value))} />
      </div>
      <div aria-live="polite" className="min-h-5 text-sm text-zinc-600">
        {cepState.status === "loading" && "Buscando endereço…"}
        {cepState.status === "ok" && `${cepState.street}, ${cepState.district}, ${cepState.city}/${cepState.state}`}
        {manual && (cepState.reason === "not_found" ? "Não achei esse CEP. Confira ou preencha o endereço abaixo." : "Preencha o endereço abaixo.")}
      </div>
      {manual && (
        <>
          <div>
            <label htmlFor={ids.street} className="ph-label">Rua</label>
            <input id={ids.street} className="ph-input" autoComplete="address-line1" value={street} disabled={locked} onChange={(e) => setStreet(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label htmlFor={ids.district} className="ph-label">Bairro</label>
            <input id={ids.district} className="ph-input" value={district} disabled={locked} onChange={(e) => setDistrict(e.target.value)} maxLength={80} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor={ids.city} className="ph-label">Cidade</label>
              <input id={ids.city} className="ph-input" value={city} disabled={locked} onChange={(e) => setCity(e.target.value)} maxLength={80} />
            </div>
            <div className="w-20">
              <label htmlFor={ids.uf} className="ph-label">UF</label>
              <input id={ids.uf} className="ph-input uppercase" value={uf} disabled={locked} onChange={(e) => setUf(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2))} maxLength={2} />
            </div>
          </div>
        </>
      )}
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={ids.num} className="ph-label">
            Número
          </label>
          <input id={ids.num} className="ph-input" value={noNumber ? "" : number} placeholder={noNumber ? "sem número" : "12 ou 12B"} disabled={locked || noNumber} onChange={(e) => setNumber(e.target.value)} maxLength={10} aria-describedby={`${ids.num}-hint`} />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--ph-primary)]" checked={noNumber} disabled={locked} onChange={(e) => setNoNumber(e.target.checked)} />
          sem número
        </label>
      </div>
      <p id={`${ids.num}-hint`} className="-mt-1.5 text-xs text-zinc-500">
        {ui.numberHint || 'Use só números, 12B ou "sem número"'}
      </p>
      <div>
        <label htmlFor={ids.comp} className="ph-label">Complemento (opcional)</label>
        <input id={ids.comp} className="ph-input" value={complement} disabled={locked} onChange={(e) => setComplement(e.target.value)} maxLength={60} />
      </div>
      <div>
        <label htmlFor={ids.ref} className="ph-label">Ponto de referência (opcional)</label>
        <input id={ids.ref} className="ph-input" value={reference} disabled={locked} onChange={(e) => setReference(e.target.value)} maxLength={100} />
      </div>
      <button type="submit" className="ph-btn" disabled={locked || !canSubmit}>
        {pending ? "Salvando…" : "Continuar"}
      </button>
      {saved && !done && (
        <button type="button" className="ph-link w-fit text-sm" disabled={locked} onClick={() => setMode("confirm")}>
          Voltar ao endereço salvo
        </button>
      )}
      <ErrorLine message={error} />
    </form>
  );
}

// ------------------------------------------------------------------------------------------
// Fulfillment (entrega / retirada)
// ------------------------------------------------------------------------------------------

function FulfillmentChoice({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const { pending, error, done, run } = useCardAction(ctx);
  const locked = !ctx.interactive || done || pending || ctx.busy;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2" role="group" aria-label="Como você quer receber?">
        {ui.options.map((o: any) => (
          <button key={o.value} type="button" className={`ph-card flex min-h-[44px] items-center justify-between gap-3 p-3 text-left disabled:cursor-not-allowed ${o.disabled ? "" : "disabled:opacity-50"}`} disabled={locked || o.disabled} aria-disabled={locked || o.disabled ? true : undefined} onClick={() => run({ type: "checkout.fulfillment", fulfillment: o.value }, o.label)}>
            <span>
              <span className={`block text-sm font-semibold ${o.disabled ? "text-zinc-500" : ""}`}>{o.label}</span>
              {o.disabled && o.disabledReason ? (
                <span className="block text-xs font-medium text-red-800">Indisponível: {o.disabledReason}</span>
              ) : (
                o.etaLabel && <span className="block text-xs text-zinc-500">{o.etaLabel}</span>
              )}
            </span>
            <span className={`text-sm font-bold ${o.disabled ? "text-zinc-500" : ""}`}>{o.disabled ? "—" : o.feeCents ? formatBRL(o.feeCents) : "Grátis"}</span>
          </button>
        ))}
      </div>
      <ErrorLine message={error} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Order review (S8) and confirmation (S9)
// ------------------------------------------------------------------------------------------

function OrderReview({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const items: any[] = Array.isArray(ui.items) ? ui.items : [];
  const { pending, error, done, run } = useCardAction(ctx);
  const locked = !ctx.interactive || done || pending || ctx.busy;
  return (
    <div className="ph-card flex flex-col gap-2 p-3.5">
      {items.map((it, i) => (
        <div key={it.productId ?? i} className="flex justify-between gap-3 text-sm">
          <span>
            {it.qty}× {it.name}
          </span>
          <span className="flex-none">{formatBRL(it.lineTotalCents)}</span>
        </div>
      ))}
      {ui.fulfillment === "delivery" && (
        <div className="flex justify-between text-sm text-zinc-500">
          <span>Entrega</span>
          <span>{ui.deliveryFeeCents ? formatBRL(ui.deliveryFeeCents) : "Grátis"}</span>
        </div>
      )}
      <hr className="border-zinc-200" />
      <div className="flex justify-between text-sm font-bold">
        <span>Total</span>
        <span>{formatBRL(ui.totalCents)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-600">
        {ui.fulfillment === "pickup" ? "Retirada em loja" : `Entrega em ${ui.addressLabel ?? "seu endereço"}`}
        {ui.etaLabel ? ` · ${ui.etaLabel}` : ""}
        <br />
        {ui.paymentLabel || "Pagamento na entrega"}
      </p>
      {ui.staleStockNotice && <div className="ph-alert ph-alert-amber">{ui.staleStockNotice}</div>}
      <button type="button" className="ph-btn" disabled={locked} onClick={() => run({ type: "checkout.confirm" }, "Confirmar pedido")}>
        {pending ? "Enviando pedido…" : done ? "Pedido enviado ✓" : "Confirmar pedido"}
      </button>
      <ErrorLine message={error} />
    </div>
  );
}

function OrderConfirmation({ ui }: { ui: PharmacyUiPayload }) {
  const link = safeLink(ui.statusUrl);
  const confirmed = ui.status === "confirmed";
  const pickup = ui.fulfillment === "pickup";
  const steps = [
    { label: "Recebido", on: true },
    { label: "Confirmado", on: confirmed },
    { label: pickup ? "Pronto para retirada" : "Em entrega", on: false },
    { label: pickup ? "Retirado" : "Entregue", on: false },
  ];
  return (
    <div className="ph-card flex flex-col gap-2.5 p-3.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <b>{ui.code}</b>
        {typeof ui.totalCents === "number" && <span className="text-zinc-600">Total {formatBRL(ui.totalCents)}</span>}
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Etapas do pedido">
        {steps.map((s) => (
          <li key={s.label} className={s.on ? "ph-badge ph-badge-soft" : "ph-badge"} aria-current={s.on && s.label === (confirmed ? "Confirmado" : "Recebido") ? "step" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      {!confirmed && <p className="text-xs text-zinc-600">A farmácia confirma em instantes.</p>}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="ph-btn ph-btn-outline w-fit no-underline">
          Acompanhar pedido
        </a>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Prescription upload (S9, second half): consent, camera/file, private upload endpoint
// ------------------------------------------------------------------------------------------

const DEFAULT_RX_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function RxUpload({ ui, ctx }: { ui: PharmacyUiPayload; ctx: PharmacyUiContext }) {
  const accept: string[] = Array.isArray(ui.accept) && ui.accept.length ? ui.accept : DEFAULT_RX_TYPES;
  const maxBytes: number = typeof ui.maxBytes === "number" ? ui.maxBytes : 8 * 1024 * 1024;
  const consent: ConsentCardData | null = ui.consent && typeof ui.consent.text === "string" ? ui.consent : null;
  const [patientName, setPatientName] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  // The pick buttons ARE the consent when the notice is on the card ("Concordo e tirar foto").
  const canPick = status !== "uploading" && Boolean(ctx.conversationId);

  async function onPick(file: File | undefined) {
    if (!file || !ctx.conversationId) return;
    setError(null);
    if (!accept.includes(file.type)) {
      setError("Formato não aceito. Envie uma foto (JPG, PNG, WEBP) ou um PDF.");
      return;
    }
    if (file.size > maxBytes) {
      setError(`Arquivo muito grande (máximo ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      return;
    }
    setStatus("uploading");
    try {
      const res = await uploadPrescription(ctx.businessId, ctx.conversationId, file, patientName);
      setCode(res.prescription.code);
      setStatus("done");
      ctx.onRxUploaded(res.prescription.code);
    } catch (e) {
      setStatus("idle");
      const code = (e as { data?: { code?: string } })?.data?.code;
      setError(code === "CONSENT_REQUIRED" ? "É preciso aceitar o aviso para enviar a receita." : apiErrorMessage(e, "Não consegui enviar a receita. Tente de novo."));
    } finally {
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (status === "done") {
    return (
      <div className="ph-card flex flex-col gap-2 p-3.5">
        <div className="text-sm">
          <b>Receita {code} enviada.</b> Ela fica guardada com segurança e só o farmacêutico consegue ver.
        </div>
        <button type="button" className="ph-link w-fit text-sm" onClick={() => setStatus("idle")}>
          Enviar outra receita
        </button>
      </div>
    );
  }

  return (
    <div className="ph-card flex flex-col gap-2.5 p-3.5">
      {consent && <ConsentNotice consent={consent} />}
      <div>
        <label htmlFor={nameId} className="ph-label">
          Nome do paciente (opcional)
        </label>
        <input id={nameId} className="ph-input" value={patientName} onChange={(e) => setPatientName(e.target.value)} disabled={status === "uploading"} maxLength={100} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ph-btn ph-btn-outline" disabled={!canPick} onClick={() => cameraRef.current?.click()}>
          {consent ? "Concordo e tirar foto" : "Tirar foto"}
        </button>
        <button type="button" className="ph-btn ph-btn-outline" disabled={!canPick} onClick={() => fileRef.current?.click()}>
          {consent ? "Concordo e escolher arquivo" : "Escolher arquivo"}
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-label="Tirar foto da receita" onChange={(e) => onPick(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept={accept.join(",")} className="hidden" tabIndex={-1} aria-label="Escolher arquivo da receita" onChange={(e) => onPick(e.target.files?.[0])} />
      </div>
      <div aria-live="polite" className="text-xs text-zinc-600">
        {status === "uploading" && "Enviando receita…"}
      </div>
      <ErrorLine message={error} />
    </div>
  );
}

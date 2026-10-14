"use client";

import { useEffect, useState } from "react";
import { getPublicOrder, resolveApiAsset, type PublicOrderDto } from "../../lib/api";
import { pharmacyThemeVars } from "../../lib/pharmacy-theme";
import { formatBRL } from "./format";

const POLL_MS = 20_000;
const TERMINAL = new Set(["delivered", "canceled", "rejected"]);

const HEADLINE: Record<PublicOrderDto["status"], { title: string; text: (o: PublicOrderDto) => string }> = {
  pending_pharmacist: { title: "Pedido recebido", text: () => "A farmácia está conferindo seu pedido. Você não precisa fazer nada agora." },
  confirmed: { title: "Pedido confirmado", text: () => "A farmácia confirmou e está separando seus itens." },
  out_for_delivery: { title: "Saiu para entrega", text: () => "Seu pedido está a caminho. Deixe o telefone por perto." },
  ready_for_pickup: { title: "Pronto para retirada", text: () => "Seu pedido está separado. Pode retirar na loja." },
  delivered: { title: "Pedido concluído", text: (o) => (o.fulfillment === "pickup" ? "Pedido retirado. Obrigado!" : "Pedido entregue. Obrigado!") },
  canceled: { title: "Pedido cancelado", text: () => "Este pedido foi cancelado." },
  rejected: { title: "Pedido não concluído", text: () => "A farmácia não pôde concluir este pedido." },
};

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function OrderStatusView({ token }: { token: string }) {
  const [order, setOrder] = useState<PublicOrderDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notFound" | "error">("loading");
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const data = await getPublicOrder(token);
        if (cancelled) return;
        setOrder(data);
        setState("ready");
        if (!TERMINAL.has(data.status)) schedule();
      } catch (error) {
        if (cancelled) return;
        if ((error as { status?: number })?.status === 404) {
          setState("notFound");
          return;
        }
        // Transient failure: keep whatever is on screen and retry.
        setState((prev) => (prev === "ready" ? "ready" : "error"));
        schedule();
      }
    }
    function schedule() {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") load();
        else schedule();
      }, POLL_MS);
    }
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const theme = pharmacyThemeVars(order?.pharmacy?.branding);

  if (state === "loading") {
    return (
      <main style={theme} className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 text-zinc-600">
        <p role="status">Carregando seu pedido…</p>
      </main>
    );
  }
  if (state === "notFound" || state === "error" || !order) {
    return (
      <main style={theme} className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 text-center text-zinc-700">
        <div>
          <h1 className="text-lg font-semibold">{state === "notFound" ? "Pedido não encontrado" : "Não consegui carregar o pedido"}</h1>
          <p className="mt-2 text-sm">
            {state === "notFound" ? "Confira o link que você recebeu no chat. Se o problema continuar, fale com a farmácia." : "Verifique sua conexão. Vamos tentar de novo em instantes."}
          </p>
        </div>
      </main>
    );
  }

  const head = HEADLINE[order.status] ?? HEADLINE.pending_pharmacist;
  const logo = !logoFailed ? resolveApiAsset(order.pharmacy.logoUrl) : null;
  const phoneDigits = (order.pharmacy.phone ?? "").replace(/\D/g, "");
  const failed = order.status === "canceled" || order.status === "rejected";

  return (
    <main style={theme} className="min-h-dvh bg-zinc-50 pb-10">
      <header className="px-4 py-4" style={{ background: "var(--ph-primary)", color: "var(--ph-primary-fg)" }}>
        <div className="mx-auto flex max-w-md items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-10 w-10 flex-none rounded-full bg-white object-cover" onError={() => setLogoFailed(true)} />
          ) : (
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white text-sm font-bold text-zinc-900" aria-hidden>
              {order.pharmacy.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{order.pharmacy.name}</div>
            <div className="text-xs opacity-90">Acompanhamento do pedido</div>
          </div>
        </div>
      </header>

      <div className="mx-auto mt-4 flex max-w-md flex-col gap-4 px-4">
        <section className="ph-card p-4" aria-labelledby="ph-status-title">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-zinc-500">Pedido</span>
            <span className="text-sm font-bold">{order.code}</span>
          </div>
          <h1 id="ph-status-title" className="mt-2 text-xl font-bold" style={{ color: failed ? "#b91c1c" : "var(--ph-secondary)" }}>
            {head.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-700" role="status" aria-live="polite">
            {head.text(order)}
          </p>
          {order.canceled && (
            <div className="ph-alert ph-alert-red mt-3">
              <b>Motivo:</b> {order.canceled.reason}
              {order.canceled.at ? <span className="block text-xs opacity-80">{timeLabel(order.canceled.at)}</span> : null}
            </div>
          )}
        </section>

        {!failed && (
          <section className="ph-card p-4" aria-label="Etapas do pedido">
            <ol className="flex flex-col">
              {order.steps.map((step, i) => {
                const last = i === order.steps.length - 1;
                const current = step.done && (last || !order.steps[i + 1]?.done);
                return (
                  <li key={step.key} className="flex gap-3" aria-current={current ? "step" : undefined}>
                    <div className="flex flex-col items-center">
                      <span
                        className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-xs font-bold"
                        style={step.done ? { background: "var(--ph-primary)", borderColor: "var(--ph-primary)", color: "var(--ph-primary-fg)" } : { background: "#fff", borderColor: "#d4d4d8", color: "#a1a1aa" }}
                        aria-hidden
                      >
                        {step.done ? "✓" : i + 1}
                      </span>
                      {!last && <span className="my-0.5 w-0.5 flex-1" style={{ background: step.done && order.steps[i + 1]?.done ? "var(--ph-primary)" : "#e4e4e7", minHeight: 18 }} />}
                    </div>
                    <div className="pb-3">
                      <div className={step.done ? "text-sm font-semibold text-zinc-900" : "text-sm text-zinc-500"}>
                        {step.label}
                        <span className="ph-sr-only">{step.done ? " (concluído)" : " (pendente)"}</span>
                      </div>
                      {step.at && <div className="text-xs text-zinc-500">{timeLabel(step.at)}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="ph-card p-4" aria-label="Resumo do pedido">
          <ul className="flex flex-col gap-1.5">
            {order.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 text-sm">
                <span>
                  {it.qty}× {it.name}
                </span>
                <span className="flex-none">{formatBRL(it.unitPriceCents * it.qty)}</span>
              </li>
            ))}
          </ul>
          <hr className="my-2.5 border-zinc-200" />
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-zinc-600">
              <dt>Subtotal</dt>
              <dd>{formatBRL(order.subtotalCents)}</dd>
            </div>
            {order.fulfillment === "delivery" && (
              <div className="flex justify-between text-zinc-600">
                <dt>Entrega</dt>
                <dd>{order.deliveryFeeCents ? formatBRL(order.deliveryFeeCents) : "Grátis"}</dd>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(order.totalCents)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-600">
            {order.paymentLabel}
            {order.fulfillment === "pickup" ? " · Retirada em loja" : order.addressLabel ? ` · Entrega em ${order.addressLabel}` : ""}
          </p>
        </section>

        {(phoneDigits.length >= 10 || order.pharmacy.name) && (
          <section className="ph-card flex flex-col gap-2 p-4" aria-label="Falar com a farmácia">
            <h2 className="text-sm font-semibold">Dúvidas sobre o pedido?</h2>
            {phoneDigits.length >= 10 ? (
              <div className="flex flex-wrap gap-2">
                <a className="ph-btn no-underline" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer">
                  Falar no WhatsApp
                </a>
                <a className="ph-btn ph-btn-outline no-underline" href={`tel:+${phoneDigits}`}>
                  Ligar
                </a>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Fale com {order.pharmacy.name} pelo chat em que você fez o pedido.</p>
            )}
          </section>
        )}

        <p className="text-center text-xs text-zinc-500">{TERMINAL.has(order.status) ? "Esta página não atualiza mais." : "Esta página atualiza sozinha a cada 20 segundos."}</p>
      </div>
    </main>
  );
}

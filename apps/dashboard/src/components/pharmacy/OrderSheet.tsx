"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "../../lib/api";
import {
  assignCourier,
  cancelOrder,
  getCouriers,
  getOrder,
  orderAction,
  type CancelReason,
  type OrderDetail,
} from "../../lib/pharmacy-api";
import { CANCEL_REASONS } from "../../lib/labels";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { formatBRL, formatDateTime, timeAgo } from "../../lib/format";
import { Badge, toneVariant } from "../ui/badge";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Skeleton } from "../ui/skeleton";
import { SidePanel } from "../ui/side-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { ErrorState } from "../page-kit";
import { cn } from "../../lib/utils";

const ACTION_DEFAULT_LABEL = { confirm: "Confirmar pedido", out: "Saiu para entrega", done: "Marcar como concluído", cancel: "Cancelar pedido" } as const;

/** Order detail with the actions the server says are allowed (`allowedActions`) and the cancel dialog. */
export function OrderSheet({
  orderId,
  onClose,
  onChanged,
  onOpenRx,
}: {
  orderId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenRx: (rxId: string) => void;
}) {
  const { me, can, refreshNotifications } = useSession();
  const state = useLoad<OrderDetail | null>(() => (orderId ? getOrder(orderId) : Promise.resolve(null)), [orderId]);
  const order = orderId && state.data?.id === orderId ? state.data : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason>("out_of_stock");
  const [note, setNote] = useState("");
  const [couriers, setCouriers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setError("");
    setCancelOpen(false);
  }, [orderId]);

  const canAssign = Boolean(order && order.fulfillment === "delivery" && can("pedidos", "edit") && !me?.role.ownDeliveriesOnly && order.tab !== "done" && order.tab !== "canceled");
  useEffect(() => {
    if (!canAssign) return;
    getCouriers()
      .then((r) => setCouriers(r.items))
      .catch(() => setCouriers([]));
  }, [canAssign]);

  async function run(key: string, fn: () => Promise<OrderDetail>) {
    setBusy(key);
    setError("");
    try {
      const updated = await fn();
      state.setData(updated);
      onChanged();
      void refreshNotifications();
    } catch (e) {
      if (e instanceof ApiError && e.code === "RX_PENDING") setError("Valide ou recuse a receita antes de confirmar este pedido.");
      else if (e instanceof ApiError && e.code === "INVALID_TRANSITION") {
        setError("A situação deste pedido mudou. Atualizei os dados.");
        void state.reload();
        onChanged();
      } else if (e instanceof ApiError && e.code === "OWN_DELIVERIES_ONLY") setError("Você só pode atualizar as suas próprias entregas.");
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const allowed = order?.allowedActions ?? [];
  const labelOf = (a: keyof typeof ACTION_DEFAULT_LABEL) => order?.actionLabels?.[a] ?? ACTION_DEFAULT_LABEL[a];

  return (
    <>
      <SidePanel
        open={Boolean(orderId)}
        onOpenChange={(o) => !o && onClose()}
        title={order?.code ?? "Pedido"}
        description={order ? `${timeAgo(order.createdAt)} · ${order.originLabel}` : undefined}
        footer={
          order && (
            <>
              {allowed.includes("confirm") && (
                <Button disabled={busy !== null} onClick={() => run("confirm", () => orderAction(order.id, "confirm"))}>
                  {busy === "confirm" ? "Confirmando…" : labelOf("confirm")}
                </Button>
              )}
              {allowed.includes("out") && (
                <Button disabled={busy !== null} onClick={() => run("out", () => orderAction(order.id, "out"))}>
                  {busy === "out" ? "Atualizando…" : labelOf("out")}
                </Button>
              )}
              {allowed.includes("done") && (
                <Button disabled={busy !== null} onClick={() => run("done", () => orderAction(order.id, "done"))}>
                  {busy === "done" ? "Atualizando…" : labelOf("done")}
                </Button>
              )}
              {allowed.includes("cancel") && (
                <Button variant="destructive" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
                  {labelOf("cancel")}
                </Button>
              )}
              {allowed.length === 0 && <span className="text-[13px] text-muted">Nenhuma ação disponível para a sua função neste momento.</span>}
            </>
          )
        }
      >
        {state.loading && !order && (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        )}
        {state.error && !order && <ErrorState error={state.error} onRetry={() => void state.reload()} what="este pedido" />}
        {order && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={toneVariant(order.statusBadge)}>{order.statusLabel}</Badge>
              <Badge variant="outline">{order.kindLabel}</Badge>
              <Badge variant="outline">Pagamento {order.paymentLabel}</Badge>
            </div>
            {error && <Alert variant="red">{error}</Alert>}
            {order.stale && <Alert variant="amber">A planilha de estoque estava desatualizada quando este pedido foi feito. Confirme a disponibilidade antes de aceitar.</Alert>}
            {order.rxPending && (
              <Alert
                variant="amber"
                action={
                  order.prescriptions[0] && can("receitas", "view") ? (
                    <Button variant="outline" size="sm" onClick={() => onOpenRx(order.prescriptions[0]!.id)}>
                      Abrir receita
                    </Button>
                  ) : undefined
                }
              >
                Este pedido tem receita para validar.
              </Alert>
            )}
            {order.statusReason && <Alert variant="default">Motivo: {order.statusReason}</Alert>}

            <section className="flex flex-col gap-1.5">
              <b>Cliente</b>
              <span>
                {order.customer.name}
                {order.customer.phoneFormatted ? ` · ${order.customer.phoneFormatted}` : ""}
              </span>
              {order.customer.email && <span className="text-[13px] text-muted">{order.customer.email}</span>}
              {order.conversationId && can("conversas", "view") && (
                <Link href={`/conversas?open=${order.conversationId}`} className="text-[13px] font-semibold text-accent hover:underline">
                  Abrir conversa →
                </Link>
              )}
            </section>

            {order.address && (
              <section className="flex flex-col gap-1.5">
                <b>Endereço</b>
                <span>{order.address.label}</span>
                {order.addressDiffersFromSaved && <Badge variant="amber" className="w-fit">⚠ Difere do endereço salvo</Badge>}
              </section>
            )}

            {canAssign && (
              <section className="flex flex-col gap-1.5">
                <label htmlFor="courier" className="font-semibold">
                  Entregador
                </label>
                <Select
                  id="courier"
                  value={order.courier?.id ?? ""}
                  disabled={busy !== null}
                  onChange={(e) => run("courier", () => assignCourier(order.id, e.target.value || null))}
                >
                  <option value="">Sem entregador definido</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </section>
            )}
            {!canAssign && order.courier && (
              <section className="flex flex-col gap-1.5">
                <b>Entregador</b>
                <span>{order.courier.name}</span>
              </section>
            )}

            <hr className="border-border" />
            <section className="flex flex-col gap-2">
              <b>Itens</b>
              {order.items.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3">
                  <span>
                    {i.qty}× {i.name}{" "}
                    <Badge variant={toneVariant(i.classBadge)} className="h-[18px] text-[11px]">
                      {i.classLabel}
                    </Badge>
                  </span>
                  <span className="flex-none">{formatBRL(i.lineTotalCents)}</span>
                </div>
              ))}
              <div className="flex justify-between text-muted">
                <span>{order.fulfillment === "delivery" ? "Entrega" : "Retirada"}</span>
                <span>{formatBRL(order.deliveryFeeCents)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>{formatBRL(order.totalCents)}</span>
              </div>
            </section>
            {order.notes && <p className="rounded-lg bg-bg-2 p-3 text-[13px]">{order.notes}</p>}
            {order.stockSheet && order.stockSheet.asOf && (
              <p className="text-[13px] text-muted">Estoque do catálogo atualizado {timeAgo(order.stockSheet.asOf)}</p>
            )}

            {order.timeline.length > 0 && (
              <>
                <hr className="border-border" />
                <section className="flex flex-col gap-2">
                  <b>Histórico</b>
                  <ol className="flex flex-col gap-2">
                    {order.timeline.map((t, idx) => (
                      <li key={`${t.status}-${idx}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span>
                          {t.label} <span className="text-muted">· {t.byName}</span>
                        </span>
                        <span className={cn("flex-none text-muted")}>{formatDateTime(t.at)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </>
        )}
      </SidePanel>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar {order?.code}?</DialogTitle>
            <DialogDescription>O cliente é avisado por e-mail e pela página de acompanhamento.</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Motivo" className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Motivo</span>
            {(order?.cancelReasons?.length ? order.cancelReasons : CANCEL_REASONS).map((r) => (
              <button
                key={r.code}
                type="button"
                role="radio"
                aria-checked={reason === r.code}
                onClick={() => setReason(r.code as CancelReason)}
                className={cn(
                  "flex h-9 w-full items-center justify-start rounded-lg border px-3 text-sm font-medium",
                  reason === r.code ? "border-border bg-surface text-ink ring-2 ring-accent/30" : "border-transparent text-ink hover:bg-bg-2",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {reason === "other" && (
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Descreva o motivo" aria-label="Descreva o motivo" />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null || (reason === "other" && note.trim().length < 3)}
              onClick={async () => {
                if (!order) return;
                await run("cancel", () => cancelOrder(order.id, reason, note.trim()));
                setCancelOpen(false);
              }}
            >
              {busy === "cancel" ? "Cancelando…" : "Cancelar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

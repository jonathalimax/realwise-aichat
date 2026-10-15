"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getOrders, getPrescriptions, type OrderList, type OrderTab, type RxList, type RxStatus } from "../../lib/pharmacy-api";
import { ORDER_TABS } from "../../lib/labels";
import { useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { formatBRL, timeAgo } from "../../lib/format";
import { Badge, toneVariant } from "../../components/ui/badge";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Tabs } from "../../components/ui/segmented";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { EmptyState, ErrorState, LoadState, PageHeader, PageStack, SearchBox, TableSkeleton } from "../../components/page-kit";
import { OrderSheet } from "../../components/pharmacy/OrderSheet";
import { RxSheet } from "../../components/pharmacy/RxSheet";
import { useDebounced } from "../../lib/use-debounced";

export default function PedidosPage() {
  return (
    <Suspense fallback={null}>
      <Pedidos />
    </Suspense>
  );
}

const POLL_MS = 20_000;

function Pedidos() {
  const router = useRouter();
  const params = useSearchParams();
  const { can, me } = useSession();
  const canRx = can("receitas", "view");
  const tab = params.get("tab") === "receitas" && canRx ? "receitas" : "pedidos";
  const openOrder = params.get("open");
  const openRx = params.get("rx");

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) (v === null ? p.delete(k) : p.set(k, v));
      const qs = p.toString();
      router.replace(`/pedidos${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  // pending count for the "Receitas" tab badge
  const rxCount = useLoad(() => (canRx ? getPrescriptions({ status: "pending", limit: 1 }) : Promise.resolve(null)), [canRx], { live: "prescriptions" });
  const [version, setVersion] = useState(0);
  const bump = () => {
    setVersion((v) => v + 1);
    void rxCount.reload();
  };
  const pendingRx = rxCount.data?.counts?.pending ?? 0;

  return (
    <PageStack>
      <PageHeader
        title="Pedidos"
        subtitle={me?.role.ownDeliveriesOnly ? "Suas entregas" : "Todos os pedidos feitos pelo chat, com entrega ou retirada"}
        actions={
          canRx ? (
            <Tabs
              label="Seção"
              value={tab}
              onValueChange={(v) => setParams({ tab: v === "receitas" ? "receitas" : null, open: null, rx: null })}
              options={[
                { value: "pedidos", label: "Pedidos" },
                { value: "receitas", label: "Receitas", badge: pendingRx > 0 ? <Badge variant="amber" className="h-[18px] px-1.5">{pendingRx}</Badge> : undefined },
              ]}
            />
          ) : undefined
        }
      />
      {tab === "pedidos" ? <OrdersTab version={version} onOpen={(id) => setParams({ open: id })} /> : <RxTab version={version} onOpen={(id) => setParams({ rx: id })} />}

      <OrderSheet
        orderId={openOrder}
        onClose={() => setParams({ open: null })}
        onChanged={bump}
        onOpenRx={(id) => setParams({ open: null, tab: "receitas", rx: id })}
      />
      <RxSheet rxId={openRx} onClose={() => setParams({ rx: null })} onChanged={bump} />
    </PageStack>
  );
}

function OrdersTab({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const { me } = useSession();
  // A courier never has "new"/"confirmed" orders (they only see deliveries already assigned to them): open on "Em entrega".
  const [status, setStatus] = useState<OrderTab>(me?.role.ownDeliveriesOnly ? "out" : "new");
  const [fulfillment, setFulfillment] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const [extra, setExtra] = useState<OrderList[]>([]);
  const [tail, setTail] = useState<string | null | undefined>(undefined); // cursor after the extra pages (undefined = none loaded yet)
  const [loadingMore, setLoadingMore] = useState(false);
  const state = useLoad(() => getOrders({ status, fulfillment: fulfillment || undefined, q: dq || undefined }), [status, fulfillment, dq, version], { live: "orders" });

  useEffect(() => {
    setExtra([]);
    setTail(undefined);
  }, [status, fulfillment, dq, version]);
  // keep the list fresh while the tab is visible (new orders arrive from the chat)
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void state.reload(), POLL_MS);
    return () => clearInterval(t);
  }, [state.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = state.data;
  const rows = [...(data?.items ?? []), ...extra];
  const counts = data?.counts;

  const nextCursor = tail === undefined ? data?.nextCursor ?? null : tail;
  async function more() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await getOrders({ status, fulfillment: fulfillment || undefined, q: dq || undefined, cursor: nextCursor });
      setExtra((prev) => [...prev, ...page.items]);
      setTail(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Situação"
          value={status}
          onValueChange={setStatus}
          options={ORDER_TABS.map((t) => ({ value: t.value, label: t.label, count: counts?.[t.value] ?? null }))}
        />
        <div className="flex w-full max-w-[440px] flex-wrap items-center gap-2 sm:w-auto">
          <div className="w-full sm:w-36">
            <Select aria-label="Tipo" value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
              <option value="">Todos os tipos</option>
              <option value="delivery">Entrega</option>
              <option value="pickup">Retirada</option>
            </Select>
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="Buscar por código ou cliente" label="Buscar pedido" className="sm:w-[260px]" />
        </div>
      </div>
      <Card>
        <LoadState state={state} section="pedidos" what="os pedidos" skeleton={<TableSkeleton />}>
          {rows.length === 0 ? (
            <EmptyState
              title={dq ? "Nenhum pedido encontrado" : "Nenhum pedido nesta situação"}
              description={dq ? "Tente outro código ou nome de cliente." : "Os pedidos feitos pelo chat aparecem aqui."}
            />
          ) : (
            <>
              <Table bare>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Itens</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={o.id} onClick={() => onOpen(o.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(o.id)}>
                      <TableCell className="whitespace-nowrap font-semibold">{o.code}</TableCell>
                      <TableCell>{o.customer.name}</TableCell>
                      <TableCell>{o.itemCount}</TableCell>
                      <TableCell>{formatBRL(o.totalCents)}</TableCell>
                      <TableCell>{o.kindLabel}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          <Badge variant={toneVariant(o.statusBadge)}>{o.statusLabel}</Badge>
                          {o.stale && <Badge variant="amber">Estoque antigo</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted">{o.originLabel}</TableCell>
                      <TableCell className="text-muted">{timeAgo(o.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor && (
                <div className="flex justify-center border-t border-border p-3">
                  <Button variant="outline" size="sm" onClick={more} disabled={loadingMore}>
                    {loadingMore ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )}
        </LoadState>
      </Card>
    </>
  );
}

const RX_TABS: { value: RxStatus; label: string }[] = [
  { value: "pending", label: "Aguardando" },
  { value: "approved", label: "Aprovadas" },
  { value: "rejected", label: "Recusadas" },
];

function RxTab({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<RxStatus>("pending");
  const state = useLoad(() => getPrescriptions({ status }), [status, version], { live: "prescriptions" });
  const rows: RxList[] = state.data?.items ?? [];
  return (
    <>
      <Alert variant="soft">Somente farmacêuticos com CRF cadastrado podem validar receitas. As fotos ficam guardadas por um prazo definido em Farmácia e são apagadas depois.</Alert>
      <Tabs label="Situação da receita" value={status} onValueChange={setStatus} options={RX_TABS.map((t) => ({ ...t, count: state.data?.counts?.[t.value] ?? null }))} />
      <Card>
        <LoadState state={state} section="receitas" what="as receitas">
          {rows.length === 0 ? (
            <EmptyState title="Nenhuma receita aqui" description="Receitas enviadas pelos clientes no chat aparecem para validação." />
          ) : (
            <Table bare>
              <TableHeader>
                <TableRow>
                  <TableHead>Receita</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Medicamento</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Enviada</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} onClick={() => onOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}>
                    <TableCell className="whitespace-nowrap font-semibold">{r.code}</TableCell>
                    <TableCell>{r.patientName ?? "—"}</TableCell>
                    <TableCell>{r.med}</TableCell>
                    <TableCell>{r.orderCode ?? "—"}</TableCell>
                    <TableCell className="text-muted">{timeAgo(r.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={toneVariant(r.badge)}>{r.statusLabel}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </LoadState>
      </Card>
    </>
  );
}

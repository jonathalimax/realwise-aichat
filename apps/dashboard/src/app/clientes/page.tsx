"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCustomer, getCustomers, type CustomerDetail, type CustomerList } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { useDebounced } from "../../lib/use-debounced";
import { formatBRL, timeAgo } from "../../lib/format";
import { Avatar } from "../../components/ui/avatar";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { SidePanel } from "../../components/ui/side-panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { EmptyState, ErrorState, LinkButton, LoadState, PageHeader, PageStack, SearchBox, TableSkeleton } from "../../components/page-kit";

export default function ClientesPage() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState<CustomerList[]>([]);
  const [tail, setTail] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const state = useLoad(() => getCustomers({ q: dq || undefined }), [dq], { live: ["clients", "orders"] });
  useEffect(() => {
    setExtra([]);
    setTail(undefined);
  }, [dq]);
  const rows = [...(state.data?.items ?? []), ...extra];
  const nextCursor = tail === undefined ? state.data?.nextCursor ?? null : tail;

  return (
    <PageStack>
      <PageHeader
        title="Clientes"
        subtitle="Reconhecidos pelo telefone. Cada farmácia tem a própria lista."
        actions={<SearchBox value={q} onChange={setQ} placeholder="Buscar por nome ou telefone" label="Buscar cliente" className="sm:w-[280px]" />}
      />
      <Card>
        <LoadState state={state} section="clientes" what="os clientes" skeleton={<TableSkeleton />}>
          {rows.length === 0 ? (
            <EmptyState title={dq ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"} description={dq ? "Tente outro nome ou telefone." : "Quem faz um pedido ou conversa com o Alex aparece aqui."} />
          ) : (
            <>
              <Table bare>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Pedidos</TableHead>
                    <TableHead>Último pedido</TableHead>
                    <TableHead>Endereço padrão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} onClick={() => setOpen(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(c.id)}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={c.initials} />
                          <b>{c.name}</b>
                        </div>
                      </TableCell>
                      <TableCell>{c.phoneFormatted ?? "—"}</TableCell>
                      <TableCell>{c.ordersCount}</TableCell>
                      <TableCell className="text-muted">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—"}</TableCell>
                      <TableCell className="text-muted">{c.addressLabel ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor && (
                <div className="flex justify-center border-t border-border p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={async () => {
                      setLoadingMore(true);
                      try {
                        const page = await getCustomers({ q: dq || undefined, cursor: nextCursor });
                        setExtra((p) => [...p, ...page.items]);
                        setTail(page.nextCursor);
                      } finally {
                        setLoadingMore(false);
                      }
                    }}
                  >
                    {loadingMore ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )}
        </LoadState>
      </Card>
      <CustomerSheet id={open} onClose={() => setOpen(null)} />
    </PageStack>
  );
}

function CustomerSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useSession();
  const state = useLoad<CustomerDetail | null>(() => (id ? getCustomer(id) : Promise.resolve(null)), [id], { live: ["clients", "orders"] });
  const c = id && state.data?.id === id ? state.data : null;
  return (
    <SidePanel
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={c?.name ?? "Cliente"}
      description={c ? [c.phoneFormatted, c.email].filter(Boolean).join(" · ") : undefined}
      footer={c && can("conversas", "view") ? <LinkButton href="/conversas" variant="outline">Abrir conversas</LinkButton> : undefined}
    >
      {state.loading && !c && <Skeleton className="h-48" aria-busy="true" />}
      {state.error && !c && <ErrorState error={state.error} onRetry={() => void state.reload()} what="este cliente" />}
      {c && (
        <>
          <div className="flex flex-wrap gap-2">
            {c.consent ? <Badge variant="green">Consentimento LGPD registrado</Badge> : <Badge variant="outline">Sem consentimento registrado</Badge>}
            <Badge variant="outline">{c.ordersCount} pedidos</Badge>
          </div>
          <section className="flex flex-col gap-1.5">
            <b>Endereços</b>
            {c.addresses.length === 0 ? (
              <p className="text-[13px] text-muted">Nenhum endereço salvo. Retiradas em loja não guardam endereço.</p>
            ) : (
              c.addresses.map((a) => (
                <div key={a.id} className="rounded-[10px] border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{a.label}</span>
                    {a.isDefault && !a.supersededAt && <Badge variant="soft">Padrão</Badge>}
                  </div>
                  <div className="text-xs text-muted">{a.supersededAt ? "Endereço antigo (histórico)" : "Número ocultado para proteger o cliente"}</div>
                </div>
              ))
            )}
            <div className="text-xs text-muted">Endereços antigos ficam no histórico e nunca são apagados.</div>
          </section>
          <section className="flex flex-col gap-1.5">
            <b>Pedidos recentes</b>
            {c.orders.length === 0 ? (
              <p className="text-[13px] text-muted">Nenhum pedido ainda.</p>
            ) : (
              c.orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 text-sm">
                  {can("pedidos", "view") ? (
                    <Link href={`/pedidos?open=${o.id}`} className="font-semibold hover:underline">
                      {o.code}
                    </Link>
                  ) : (
                    <b>{o.code}</b>
                  )}
                  <span className="text-muted">{timeAgo(o.createdAt)}</span>
                  <span>{formatBRL(o.totalCents)}</span>
                </div>
              ))
            )}
          </section>
          <Alert variant="soft">Sintomas, alergias e receitas não aparecem aqui. Ficam só no atendimento farmacêutico.</Alert>
        </>
      )}
    </SidePanel>
  );
}

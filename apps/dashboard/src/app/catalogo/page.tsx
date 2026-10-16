"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getProducts, type Product } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { useDebounced } from "../../lib/use-debounced";
import { formatBRL } from "../../lib/format";
import { Badge, toneVariant } from "../../components/ui/badge";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Tabs } from "../../components/ui/segmented";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { EmptyState, LinkButton, LoadState, PageHeader, PageStack, SearchBox, TableSkeleton } from "../../components/page-kit";
import { ProductThumb } from "../../components/pharmacy/ProductThumb";
import { ProductSheet } from "../../components/pharmacy/ProductSheet";

type Filter = "all" | "unclassified" | "otc" | "prescription" | "controlled" | "out" | "inactive";
const FILTERS: Filter[] = ["all", "unclassified", "otc", "prescription", "controlled", "out", "inactive"];

export default function CatalogoPage() {
  return (
    <Suspense fallback={null}>
      <Catalogo />
    </Suspense>
  );
}

function Catalogo() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const classParam = params.get("class") as Filter | null;
  const initialFilter: Filter = params.get("stock") === "out" ? "out" : classParam && FILTERS.includes(classParam) ? classParam : "all";
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const open = params.get("open");
  const [extra, setExtra] = useState<Product[]>([]);
  const [tail, setTail] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (cursor?: string) => getProducts({ class: filter === "out" || filter === "inactive" ? "all" : filter, stock: filter === "out" ? "out" : undefined, active: filter === "inactive" ? "false" : undefined, q: dq || undefined, cursor }),
    [filter, dq],
  );
  const state = useLoad(() => query(), [filter, dq]);
  useEffect(() => {
    setExtra([]);
    setTail(undefined);
  }, [filter, dq]);

  const counts = state.data?.counts;
  const rows = [...(state.data?.items ?? []), ...extra];
  const nextCursor = tail === undefined ? state.data?.nextCursor ?? null : tail;

  const setOpen = (id: string | null) => router.replace(id ? `/catalogo?open=${id}` : "/catalogo", { scroll: false });

  async function more() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await query(nextCursor);
      setExtra((p) => [...p, ...page.items]);
      setTail(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <PageStack>
      <PageHeader
        title="Catálogo"
        subtitle="Produtos que o Alex pode consultar e vender"
        actions={
          <>
            {can("classes", "view") && (
              <LinkButton href="/catalogo/classes" variant="outline">
                Revisar classes
                {counts && counts.unclassifiedAll > 0 && <Badge variant="amber" className="h-[18px] px-1.5">{counts.unclassifiedAll}</Badge>}
              </LinkButton>
            )}
            {can("importar", "view") && <LinkButton href="/catalogo/importar">Importar planilha</LinkButton>}
          </>
        }
      />
      {counts && counts.unclassifiedAll > 0 && (
        <Alert variant="amber">
          {counts.unclassifiedAll} {counts.unclassifiedAll === 1 ? "produto está sem classe e não pode" : "produtos estão sem classe e não podem"} ser {counts.unclassifiedAll === 1 ? "vendido" : "vendidos"} no chat até o farmacêutico revisar.
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Filtro"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "Todos", count: counts?.all ?? null },
            { value: "unclassified", label: "Sem classe", count: counts?.unclassified ?? null },
            { value: "otc", label: "Venda livre", count: counts?.otc ?? null },
            { value: "prescription", label: "Receita", count: counts?.prescription ?? null },
            { value: "controlled", label: "Controlados", count: counts?.controlled ?? null },
            { value: "out", label: "Sem estoque", count: counts?.outOfStock ?? null },
            { value: "inactive", label: "Inativos", count: counts?.inactive ?? null },
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Buscar produto, EAN ou princípio ativo" label="Buscar produto" className="sm:w-[300px]" />
      </div>
      <Card>
        <LoadState state={state} section="catalogo" what="o catálogo" skeleton={<TableSkeleton />}>
          {rows.length === 0 ? (
            <EmptyState
              title={dq || filter !== "all" ? "Nenhum produto encontrado" : "Seu catálogo está vazio"}
              description={dq || filter !== "all" ? "Tente outro filtro ou outra busca." : "Importe a planilha de estoque do seu sistema para o Alex conhecer seus produtos."}
              action={!dq && filter === "all" && can("importar", "edit") ? <LinkButton href="/catalogo/importar" size="sm">Importar planilha</LinkButton> : undefined}
            />
          ) : (
            <>
              <Table bare>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Classe</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead>Equivalentes</TableHead>
                    <TableHead>Farmacêutico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id} onClick={() => setOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p.id)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb product={p} />
                          <div className="min-w-0">
                            <b className="block truncate">{p.name}</b>
                            <div className="truncate text-xs text-muted">{p.subtitle}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <Badge variant={toneVariant(p.classBadge)}>{p.classLabel}</Badge>
                          {p.needsReview && <Badge variant="amber">Revisar</Badge>}
                          {!p.active && <Badge variant="outline">Inativo</Badge>}
                        </span>
                      </TableCell>
                      <TableCell>{formatBRL(p.priceCents)}</TableCell>
                      <TableCell>{p.stockQty === 0 ? <span className="text-red-700">Sem estoque</span> : p.stockQty}</TableCell>
                      <TableCell className="text-muted">{p.equivalentGroup ?? "—"}</TableCell>
                      <TableCell className="text-muted">{p.pharmacistRequired ? "Sim" : "Não"}</TableCell>
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
      <ProductSheet productId={open} onClose={() => setOpen(null)} onChanged={() => void state.reload()} />
    </PageStack>
  );
}

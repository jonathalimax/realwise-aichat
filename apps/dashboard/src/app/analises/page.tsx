"use client";

import { useState } from "react";
import { getPharmacyAnalytics, type Range } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { formatBRL } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { KpiCard } from "../../components/ui/stat-card";
import { Progress } from "../../components/ui/progress";
import { Tabs } from "../../components/ui/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Skeleton } from "../../components/ui/skeleton";
import { Bars } from "../../components/pharmacy/Bars";
import { EmptyState, LinkButton, LoadState, PageHeader, PageStack, SectionCard } from "../../components/page-kit";

const RANGES = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
] as const;

const TRIAGE_COLOR: Record<string, string> = {
  orders: "var(--brand-primary)",
  handoff: "var(--brand-tertiary)",
  controlled: "#71717a",
  red_flag: "#dc2626",
  general: "var(--brand-secondary)",
};

export default function AnalisesPage() {
  const [range, setRange] = useState<Range>("7d");
  const state = useLoad(() => getPharmacyAnalytics(range), [range]);
  const a = state.data;
  const bars = (a?.chart.buckets ?? []).map((b) => ({
    label: b.label,
    top: (b.revenueCents ?? 0) >= 100000 ? `${((b.revenueCents ?? 0) / 100000).toFixed(1)}k` : String(Math.round((b.revenueCents ?? 0) / 100)),
    segments: [{ value: b.revenueCents ?? 0, color: "var(--brand-primary)", name: "Faturamento" }],
  }));

  return (
    <PageStack>
      <PageHeader title="Análises" subtitle="Como o chat e a operação estão performando" actions={<Tabs label="Período" value={range} onValueChange={setRange} options={RANGES} />} />
      <LoadState
        state={state}
        section="analises"
        what="as análises"
        skeleton={
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
        }
      >
        {a && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {a.kpis.map((k) => (
                <KpiCard key={k.key} label={k.label} value={k.display} note={k.note} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <SectionCard className="min-w-0 flex-[2_1_480px]" title="Faturamento por dia" description={a.label}>
                {bars.every((b) => b.segments[0]!.value === 0) ? (
                  <EmptyState title="Sem faturamento neste período" description="Pedidos concluídos entram aqui." />
                ) : (
                  <Bars data={bars} height={170} ariaLabel={`Faturamento: ${a.label}`} />
                )}
              </SectionCard>
              <SectionCard className="min-w-0 flex-[1_1_320px]" title="Triagem do Alex" description="Como as conversas terminaram">
                {a.triage.every((t) => t.count === 0) ? (
                  <EmptyState title="Sem conversas neste período" />
                ) : (
                  <div className="flex flex-col gap-4">
                    {a.triage.map((t) => (
                      <div key={t.key} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[13px]">
                          <span>{t.label}</span>
                          <b>{t.count}</b>
                        </div>
                        <Progress value={t.percent} color={TRIAGE_COLOR[t.key]} />
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
            <div className="flex flex-wrap gap-4">
              <SectionCard className="min-w-0 flex-[1_1_420px]" title="Mais vendidos" flush>
                {a.topProducts.length === 0 ? (
                  <EmptyState title="Ainda sem vendas" />
                ) : (
                  <Table bare>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Unidades</TableHead>
                        <TableHead>Faturamento</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.topProducts.map((p) => (
                        <TableRow key={p.productId}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.units}</TableCell>
                          <TableCell>{formatBRL(p.revenueCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
              <SectionCard
                className="min-w-0 flex-[1_1_420px]"
                title="Procurados sem estoque"
                description="Demanda que a farmácia não atendeu"
                action={<LinkButton href="/catalogo" variant="outline" size="sm">Catálogo</LinkButton>}
                flush
              >
                {a.unmetDemand.length === 0 ? (
                  <EmptyState title="Nenhuma demanda perdida" />
                ) : (
                  <Table bare>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Pedidos perdidos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.unmetDemand.map((p) => (
                        <TableRow key={p.productId}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>
                            <Badge variant="amber">{p.requests}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </div>
          </>
        )}
      </LoadState>
    </PageStack>
  );
}

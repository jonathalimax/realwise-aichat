"use client";

import { useState } from "react";
import Link from "next/link";
import { getDashboardSummary, type DashboardSummary, type Range } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { formatBRL, waitingLabel, timeAgo } from "../../lib/format";
import { Badge, toneVariant } from "../../components/ui/badge";
import { Alert } from "../../components/ui/alert";
import { KpiCard } from "../../components/ui/stat-card";
import { Tabs } from "../../components/ui/segmented";
import { Progress } from "../../components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Skeleton } from "../../components/ui/skeleton";
import { Bars, LegendDot } from "../../components/pharmacy/Bars";
import { EmptyState, LinkButton, LoadState, PageHeader, PageStack, SectionCard } from "../../components/page-kit";

const RANGES = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
] as const;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function InicioPage() {
  const { me, can } = useSession();
  const [range, setRange] = useState<Range>("7d");
  const state = useLoad(() => getDashboardSummary(range), [range]);
  const s = state.data;
  // Skip honorifics ("Dra. Carla Menezes" -> "Carla").
  const firstName = me?.member.name.split(" ").find((w) => !/^(dr|dra|sr|sra|prof|profa)\.?$/i.test(w)) ?? "";

  return (
    <PageStack>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={`Resumo na ${me?.business.name ?? "farmácia"}`}
        actions={<Tabs label="Período" value={range} onValueChange={setRange} options={RANGES} />}
      />
      <LoadState state={state} section="inicio" what="o resumo" skeleton={<HomeSkeleton />}>
        {s && <Summary s={s} canImport={can("importar", "edit")} />}
      </LoadState>
    </PageStack>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function Summary({ s, canImport }: { s: DashboardSummary; canImport: boolean }) {
  const handoffsFirst = s.roleFocus === "handoffs";
  return (
    <>
      <StockAlert stock={s.stock} canImport={canImport} />

      {s.kpis.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          {s.kpis.map((k) => (
            <KpiCard key={k.key} label={k.label} value={k.display} note={k.note} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-stretch gap-4">
        <NeedsAction items={s.needsAction} className={handoffsFirst ? "order-2" : ""} />
        {s.handoffs && <Handoffs items={s.handoffs} className={handoffsFirst ? "order-1" : ""} />}
      </div>

      {(s.chart || s.funnel) && (
        <div className="flex flex-wrap items-stretch gap-4">
          {s.chart && <OrdersChart chart={s.chart} />}
          {s.funnel && <Funnel funnel={s.funnel} />}
        </div>
      )}

      <SectionCard
        title="Insights"
        description="Sugestões geradas a partir das conversas e dos pedidos"
        action={<Badge variant="soft">IA</Badge>}
      >
        {s.insights.length === 0 ? (
          <EmptyState title="Sem sugestões por enquanto" description="Quando houver pedidos e conversas suficientes, as sugestões aparecem aqui." />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
            {s.insights.map((i) => (
              <div key={i.id} className="flex flex-col gap-1.5 rounded-[10px] border border-border p-4">
                <b className="text-ink">{i.title}</b>
                <span className="text-[13px] text-muted">{i.description}</span>
                {i.cta && (
                  <Link href={i.cta.href} className="text-[13px] font-semibold text-accent hover:underline">
                    {i.cta.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}

function StockAlert({ stock, canImport }: { stock: DashboardSummary["stock"]; canImport: boolean }) {
  const action = canImport ? <LinkButton href="/catalogo/importar" variant="outline" size="sm">Atualizar planilha</LinkButton> : undefined;
  if (!stock || !stock.asOf) {
    return (
      <Alert variant="amber" action={action}>
        Nenhuma planilha de estoque foi importada ainda. Sem ela, o Alex não consegue confirmar pedidos automaticamente.
      </Alert>
    );
  }
  return (
    <Alert variant={stock.stale ? "amber" : "soft"} action={action}>
      {stock.stale
        ? `A planilha de estoque está desatualizada (${stock.display.toLowerCase()}). Acima de ${stock.maxAgeHours} horas, todo pedido passa pelo farmacêutico.`
        : `${stock.display}. O limite para confirmar pedidos automaticamente é ${stock.maxAgeHours} horas.`}
    </Alert>
  );
}

function NeedsAction({ items, className }: { items: DashboardSummary["needsAction"]; className?: string }) {
  return (
    <SectionCard
      className={`min-w-0 flex-[2_1_520px] ${className ?? ""}`}
      title="Pedidos que exigem ação"
      description="Ordenados por tempo de espera"
      action={<LinkButton href="/pedidos" variant="outline" size="sm">Ver todos</LinkButton>}
      flush
    >
      {items.length === 0 ? (
        <EmptyState title="Nada esperando por você" description="Novos pedidos e receitas para validar aparecem aqui." />
      ) : (
        <Table bare>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Espera</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((o) => (
              <TableRow key={o.orderId}>
                <TableCell>
                  <Link href={`/pedidos?open=${o.orderId}`} className="font-semibold hover:underline">
                    {o.code}
                  </Link>
                </TableCell>
                <TableCell>{o.customerName}</TableCell>
                <TableCell>{formatBRL(o.totalCents)}</TableCell>
                <TableCell>{o.kindLabel}</TableCell>
                <TableCell>
                  <Badge variant={toneVariant(o.badge)}>{o.reason === "validate_rx" ? "Validar receita" : o.reason === "stale_stock" ? "Estoque antigo" : o.statusLabel}</Badge>
                </TableCell>
                <TableCell className="text-muted">{waitingLabel(o.waitingMinutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

function Handoffs({ items, className }: { items: DashboardSummary["handoffs"]; className?: string }) {
  return (
    <SectionCard
      className={`min-w-0 flex-[1_1_320px] ${className ?? ""}`}
      title="Atendimentos abertos"
      description="Encaminhados pelo Alex"
      action={<LinkButton href="/atendimento" variant="outline" size="sm">Abrir</LinkButton>}
    >
      {items.length === 0 ? (
        <EmptyState title="Nenhum atendimento aberto" />
      ) : (
        <div className="flex flex-col gap-3.5">
          {items.map((h) => (
            <Link key={h.id} href={`/atendimento?open=${h.id}`} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
              <span className="flex items-center justify-between gap-2">
                <b>{h.who}</b>
                <Badge variant={toneVariant(h.badge)}>{h.tag}</Badge>
              </span>
              <span className="text-[13px] text-muted">{h.summary}</span>
              <span className="text-xs text-muted">{timeAgo(h.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function OrdersChart({ chart }: { chart: NonNullable<DashboardSummary["chart"]> }) {
  const hasSplit = chart.buckets.some((b) => b.delivery !== undefined || b.pickup !== undefined);
  const data = chart.buckets.map((b) => ({
    label: b.label,
    segments: hasSplit
      ? [
          { value: b.delivery ?? 0, color: "var(--brand-primary)", name: "Entrega" },
          { value: b.pickup ?? 0, color: "var(--brand-tertiary)", name: "Retirada" },
        ]
      : [{ value: b.orders ?? 0, color: "var(--brand-primary)", name: "Pedidos" }],
  }));
  const empty = data.every((d) => d.segments.every((s) => s.value === 0));
  return (
    <SectionCard
      className="min-w-0 flex-[2_1_520px]"
      title="Pedidos e faturamento"
      description={chart.title}
      action={
        hasSplit ? (
          <span className="flex items-center gap-3">
            <LegendDot color="var(--brand-primary)" label="Entrega" />
            <LegendDot color="var(--brand-tertiary)" label="Retirada" />
          </span>
        ) : undefined
      }
    >
      {empty ? (
        <EmptyState title="Sem pedidos neste período" description="Os pedidos feitos pelo chat aparecem aqui." />
      ) : (
        <Bars data={data} ariaLabel={`Pedidos por período: ${chart.title}`} />
      )}
    </SectionCard>
  );
}

function Funnel({ funnel }: { funnel: NonNullable<DashboardSummary["funnel"]> }) {
  const rows = [
    { label: "Conversas", n: funnel.conversations },
    { label: "Carrinhos", n: funnel.carts },
    { label: "Pedidos", n: funnel.orders },
  ];
  const base = Math.max(1, funnel.conversations);
  return (
    <SectionCard className="min-w-0 flex-[1_1_320px]" title="Funil do chat" description="Da conversa ao pedido">
      <div className="flex flex-col gap-[18px]">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[13px]">
              <span>{r.label}</span>
              <b>{r.n}</b>
            </div>
            <Progress value={(r.n / base) * 100} />
          </div>
        ))}
        <p className="text-[13px] text-muted">
          Conversão de conversa em pedido: <b className="text-ink">{(funnel.conversionRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>
        </p>
      </div>
    </SectionCard>
  );
}

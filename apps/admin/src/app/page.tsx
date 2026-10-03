"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users, Activity, MessageSquare, UserCheck, DollarSign, CheckCircle2, Clock, Ban, MoreHorizontal, FileSearch } from "lucide-react";
import {
  getTenants,
  getGlobalMetrics,
  getMetricsTimeseries,
  getConfidenceDistribution,
  getExtractionCostMetrics,
  bulkSuspendTenants,
} from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "../components/ui/card";
import { Badge, statusToBadgeVariant } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Button } from "../components/ui/button";
import { DataTableToolbar, FilterDropdown } from "../components/ui/data-table-toolbar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";
import { StatCard } from "../components/ui/stat-card";
import { SegmentedControl } from "../components/ui/segmented";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ConfidenceDistributionChart } from "../components/charts/ConfidenceDistributionChart";

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  live: CheckCircle2,
  pending_review: Clock,
  onboarding: Clock,
  suspended: Ban,
  churned: Ban,
};
const STATUS_LABELS: Record<string, string> = {
  live: "Ativo",
  pending_review: "Pendente",
  onboarding: "Onboarding",
  suspended: "Suspenso",
  churned: "Churned",
};
// Light-traffic costs are often sub-cent — fixed .toFixed(2) would show "$0.00" for real non-zero usage.
function formatCostUsd(value: number): string {
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

const STATUS_OPTIONS = [
  { value: "live", label: "Ativo" },
  { value: "pending_review", label: "Pendente" },
  { value: "suspended", label: "Suspenso" },
  { value: "churned", label: "Churned" },
];

const STAT_CARDS = [
  { key: "tenantCount", label: "Clientes", icon: Users },
  { key: "liveTenantCount", label: "Ativos", icon: Activity },
  { key: "conversationCount", label: "Conversas", icon: MessageSquare },
  { key: "leadCount", label: "Leads", icon: UserCheck },
] as const;

const RANGE_OPTIONS = [
  { label: "Últimos 7 dias", value: "7" },
  { label: "Últimos 30 dias", value: "30" },
  { label: "Últimos 3 meses", value: "90" },
] as const;

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return ((current - previous) / previous) * 100;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [extractionCost, setExtractionCost] = useState<any>(null);
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [filter, setFilter] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortByCost, setSortByCost] = useState<"asc" | "desc" | null>(null);

  useEffect(() => {
    getTenants().then(setTenants).catch(() => setTenants([]));
    getGlobalMetrics().then(setMetrics).catch(() => {});
    getConfidenceDistribution().then(setDistribution).catch(() => setDistribution([]));
  }, []);

  useEffect(() => {
    getMetricsTimeseries(Number(range)).then(setTimeseries).catch(() => setTimeseries([]));
    getExtractionCostMetrics(Number(range)).then(setExtractionCost).catch(() => {});
  }, [range]);

  const filteredTenants = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = tenants.filter((t) => {
      const matchesTerm = !term || t.name?.toLowerCase().includes(term) || t.slug?.toLowerCase().includes(term);
      const matchesStatus = statuses.length === 0 || statuses.includes(t.status);
      return matchesTerm && matchesStatus;
    });
    if (!sortByCost) return filtered;
    return [...filtered].sort((a, b) =>
      sortByCost === "asc" ? (a.costUsd7d ?? 0) - (b.costUsd7d ?? 0) : (b.costUsd7d ?? 0) - (a.costUsd7d ?? 0),
    );
  }, [tenants, filter, statuses, sortByCost]);

  function toggleCostSort() {
    setSortByCost((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  const allSelected = filteredTenants.length > 0 && filteredTenants.every((t) => selected.has(t.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filteredTenants.map((t) => t.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function suspendSelected() {
    if (!window.confirm(`Suspender ${selected.size} cliente(s) selecionado(s)?`)) return;
    const { notFoundIds } = await bulkSuspendTenants([...selected]);
    if (notFoundIds.length > 0) {
      window.alert(`Não encontrados (não suspensos): ${notFoundIds.join(", ")}`);
    }
    setSelected(new Set());
    getTenants().then(setTenants).catch(() => setTenants([]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <StatCard
            key={key}
            label={label}
            value={metrics?.[key] ?? "—"}
            trend={metrics ? percentDelta(metrics[key] ?? 0, metrics.previous?.[key] ?? 0) : undefined}
            icon={<Icon className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
          />
        ))}
        <StatCard
          label="Custo estimado (7d)"
          value={metrics ? formatCostUsd(metrics.totalCostUsd7d ?? 0) : "—"}
          context="Estimativa com base em preços públicos, não é a fatura real"
          icon={<DollarSign className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Custo de extração automática</CardTitle>
          <CardDescription>Janela de {range} dias — pipeline de scraping em segundo plano vs. extração na rota do chat.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={`Custo extração (${range}d)`}
              value={extractionCost ? formatCostUsd(extractionCost.pipeline.costUsd) : "—"}
              context="Pipeline de scraping/anúncios — estimativa, exclui embeddings"
              icon={<FileSearch className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
            <StatCard
              label={`Tokens extração (${range}d)`}
              value={extractionCost ? extractionCost.pipeline.totalTokens.toLocaleString("pt-BR") : "—"}
              context={
                extractionCost
                  ? `${extractionCost.pipeline.inputTokens.toLocaleString("pt-BR")} entrada / ${extractionCost.pipeline.outputTokens.toLocaleString("pt-BR")} saída`
                  : undefined
              }
              icon={<FileSearch className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
            <StatCard
              label="Chamadas de extração"
              value={extractionCost ? extractionCost.pipeline.calls : "—"}
              context={extractionCost ? `${extractionCost.pipeline.failedCalls} com erro` : undefined}
              icon={<FileSearch className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
            <StatCard
              label={`Custo extração no chat (${range}d)`}
              value={extractionCost ? formatCostUsd(extractionCost.chatPath.costUsd) : "—"}
              context="Extração na rota do visitante (inclui histórico antes da separação)"
              icon={<FileSearch className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversas</CardTitle>
            <CardAction>
              <SegmentedControl value={range} onValueChange={setRange} options={RANGE_OPTIONS} />
            </CardAction>
            <CardDescription>Volume diário de conversas iniciadas em todos os clientes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityChart data={timeseries} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de confiança</CardTitle>
            <CardDescription>Quantos negócios estão em cada faixa de prontidão.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfidenceDistributionChart data={distribution} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clientes</CardTitle>
          <CardDescription>Todos os clientes cadastrados na plataforma.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <DataTableToolbar
            filterValue={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filtrar clientes..."
            selectionCount={selected.size}
            filters={<FilterDropdown label="Status" options={STATUS_OPTIONS} selected={statuses} onChange={setStatuses} />}
            actions={
              selected.size > 0 && (
                <Button variant="outline" size="sm" onClick={suspendSelected}>
                  Suspender selecionados
                </Button>
              )
            }
          />
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                  </TableHead>
                  <TableHead>Negócio</TableHead>
                  <TableHead>Nicho</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>
                    <button type="button" onClick={toggleCostSort} className="flex items-center gap-1 hover:text-ink">
                      Custo (7d)
                      {sortByCost && <span className="text-[10px]">{sortByCost === "desc" ? "▼" : "▲"}</span>}
                    </button>
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((t) => {
                  const StatusIcon = STATUS_ICON[t.status] ?? Clock;
                  return (
                    <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleOne(t.id)} aria-label="Selecionar cliente" />
                      </TableCell>
                      <TableCell>
                        <Link href={`/tenants/${t.id}`} className="font-semibold text-ink hover:text-accent">
                          {t.name || t.slug}
                        </Link>
                      </TableCell>
                      <TableCell className="text-ink-soft">{t.niche}</TableCell>
                      <TableCell>
                        <Badge variant={statusToBadgeVariant(t.status)} className="gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {STATUS_LABELS[t.status] ?? t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-ink-soft">{t.subscription?.plan?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono">{t.confidenceScore}%</TableCell>
                      <TableCell className="text-ink-soft">{formatCostUsd(t.costUsd7d ?? 0)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded-lg p-1.5 text-ink-soft hover:bg-bg-2" aria-label="Ações">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/tenants/${t.id}`}>Ver detalhes</Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2 lg:hidden">
            <div className="mb-1">
              <Button
                variant="outline"
                size="sm"
                className={sortByCost ? "border-accent text-accent" : undefined}
                onClick={toggleCostSort}
              >
                Custo (7d) {sortByCost && (sortByCost === "desc" ? "▼" : "▲")}
              </Button>
            </div>
            {filteredTenants.map((t) => {
              const StatusIcon = STATUS_ICON[t.status] ?? Clock;
              const isSelected = selected.has(t.id);
              return (
                <div
                  key={t.id}
                  data-state={isSelected ? "selected" : undefined}
                  className="rounded-lg border border-border bg-bg-2 p-3 data-[state=selected]:border-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className="-m-2 flex min-h-11 min-w-11 items-center justify-center p-2">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(t.id)} aria-label="Selecionar cliente" />
                    </span>
                    <Link href={`/tenants/${t.id}`} className="flex-1 truncate font-semibold text-ink hover:text-accent">
                      {t.name || t.slug}
                    </Link>
                    <Badge variant={statusToBadgeVariant(t.status)} className="gap-1">
                      <StatusIcon className="h-3 w-3" />
                      {STATUS_LABELS[t.status] ?? t.status}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-ink-soft">Nicho</div>
                      <div className="text-ink">{t.niche ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-ink-soft">Plano</div>
                      <div className="text-ink">{t.subscription?.plan?.name ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-ink-soft">Confiança</div>
                      <div className="font-mono text-ink">{t.confidenceScore}%</div>
                    </div>
                    <div>
                      <div className="text-ink-soft">Custo (7d)</div>
                      <div className="text-ink">{formatCostUsd(t.costUsd7d ?? 0)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

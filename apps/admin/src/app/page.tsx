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
  getConversationCostMetrics,
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

const CONVERSATION_COST_PAGE_SIZE = 20;

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

  const [conversationCost, setConversationCost] = useState<any>(null);
  const [conversationRange, setConversationRange] = useState<"7" | "30" | "90">("30");
  const [conversationClientFilter, setConversationClientFilter] = useState<string[]>([]);
  const [conversationSortBy, setConversationSortBy] = useState<"cost" | "date" | "tokens">("date");
  const [conversationSortOrder, setConversationSortOrder] = useState<"asc" | "desc">("desc");
  const [conversationOffset, setConversationOffset] = useState(0);

  useEffect(() => {
    getTenants().then(setTenants).catch(() => setTenants([]));
    getGlobalMetrics().then(setMetrics).catch(() => {});
    getConfidenceDistribution().then(setDistribution).catch(() => setDistribution([]));
  }, []);

  useEffect(() => {
    getMetricsTimeseries(Number(range)).then(setTimeseries).catch(() => setTimeseries([]));
    getExtractionCostMetrics(Number(range)).then(setExtractionCost).catch(() => {});
  }, [range]);

  useEffect(() => {
    setConversationOffset(0);
  }, [conversationRange, conversationClientFilter, conversationSortBy, conversationSortOrder]);

  useEffect(() => {
    const since = new Date(Date.now() - Number(conversationRange) * 24 * 3600 * 1000);
    getConversationCostMetrics({
      businessId: conversationClientFilter[0],
      from: since.toISOString(),
      sortBy: conversationSortBy,
      sortOrder: conversationSortOrder,
      limit: CONVERSATION_COST_PAGE_SIZE,
      offset: conversationOffset,
    })
      .then(setConversationCost)
      .catch(() => setConversationCost(null));
  }, [conversationRange, conversationClientFilter, conversationSortBy, conversationSortOrder, conversationOffset]);

  function toggleConversationSort(field: "cost" | "date" | "tokens") {
    if (conversationSortBy === field) {
      setConversationSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setConversationSortBy(field);
      setConversationSortOrder("desc");
    }
  }

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
        <CardContent className="pt-0">
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

      <Card>
        <CardHeader>
          <CardTitle>Custo de conversas</CardTitle>
          <CardAction>
            <SegmentedControl value={conversationRange} onValueChange={setConversationRange} options={RANGE_OPTIONS} />
          </CardAction>
          <CardDescription>
            Custo real das respostas do chat (purpose=&quot;chat&quot;), agrupado por cliente e dia — granularidade por
            conversa individual não é possível hoje porque o log de chamadas de LLM não guarda o conversationId.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label={`Custo de conversas (${conversationRange}d)`}
              value={conversationCost ? formatCostUsd(conversationCost.totalCostUsd) : "—"}
              context="Estimativa com base em preços públicos, não é a fatura real"
              icon={<DollarSign className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
            <StatCard
              label={`Tokens de conversas (${conversationRange}d)`}
              value={conversationCost ? conversationCost.totalTokens.toLocaleString("pt-BR") : "—"}
              icon={<MessageSquare className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
            <StatCard
              label="Chamadas de chat"
              value={conversationCost ? conversationCost.totalCalls : "—"}
              icon={<MessageSquare className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <FilterDropdown
              label="Cliente"
              options={tenants.map((t) => ({ value: t.id, label: t.name || t.slug }))}
              selected={conversationClientFilter}
              onChange={(next) => setConversationClientFilter(next.slice(-1))}
            />
          </div>

          <div className="mt-3 hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleConversationSort("date")}
                      className="flex items-center gap-1 hover:text-ink"
                    >
                      Data
                      {conversationSortBy === "date" && (
                        <span className="text-[10px]">{conversationSortOrder === "desc" ? "▼" : "▲"}</span>
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleConversationSort("cost")}
                      className="flex items-center gap-1 hover:text-ink"
                    >
                      Custo
                      {conversationSortBy === "cost" && (
                        <span className="text-[10px]">{conversationSortOrder === "desc" ? "▼" : "▲"}</span>
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleConversationSort("tokens")}
                      className="flex items-center gap-1 hover:text-ink"
                    >
                      Tokens
                      {conversationSortBy === "tokens" && (
                        <span className="text-[10px]">{conversationSortOrder === "desc" ? "▼" : "▲"}</span>
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Chamadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(conversationCost?.rows ?? []).map((row: any) => (
                  <TableRow key={`${row.businessId}:${row.date}`}>
                    <TableCell>
                      <Link href={`/tenants/${row.businessId}`} className="font-semibold text-ink hover:text-accent">
                        {row.businessName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-soft">{row.date}</TableCell>
                    <TableCell className="text-ink-soft">{formatCostUsd(row.costUsd)}</TableCell>
                    <TableCell className="text-ink-soft">{row.tokens.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-ink-soft">
                      {row.calls}
                      {row.failedCalls > 0 ? ` (${row.failedCalls} com erro)` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex flex-col gap-2 lg:hidden">
            {(conversationCost?.rows ?? []).map((row: any) => (
              <div key={`${row.businessId}:${row.date}`} className="rounded-lg border border-border bg-bg-2 p-3">
                <div className="flex items-center justify-between">
                  <Link href={`/tenants/${row.businessId}`} className="font-semibold text-ink hover:text-accent">
                    {row.businessName}
                  </Link>
                  <span className="text-xs text-ink-soft">{row.date}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-ink-soft">Custo</div>
                    <div className="text-ink">{formatCostUsd(row.costUsd)}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Tokens</div>
                    <div className="text-ink">{row.tokens.toLocaleString("pt-BR")}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Chamadas</div>
                    <div className="text-ink">{row.calls}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {conversationCost && conversationOffset + CONVERSATION_COST_PAGE_SIZE < conversationCost.total && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConversationOffset((prev) => prev + CONVERSATION_COST_PAGE_SIZE)}
              >
                Carregar mais
              </Button>
            </div>
          )}
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
          <CardContent className="pt-0">
            <ActivityChart data={timeseries} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de confiança</CardTitle>
            <CardDescription>Quantos negócios estão em cada faixa de prontidão.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ConfidenceDistributionChart data={distribution} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clientes</CardTitle>
          <CardAction>
            <Link href="/tenants/new">
              <Button size="sm">Novo cliente</Button>
            </Link>
          </CardAction>
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
                  <TableHead>Modelo ativo</TableHead>
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
                      <TableCell className="text-ink-soft">
                        {t.activeChatModel?.includes("glm") ? "GLM" : "Qwen"}
                      </TableCell>
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

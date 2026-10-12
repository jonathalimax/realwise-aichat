"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Flame, Thermometer, Snowflake, MoreHorizontal } from "lucide-react";
import { getLeads, getLeadWhatsappLink } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import { Button } from "../../components/ui/button";
import { DataTableToolbar, FilterDropdown } from "../../components/ui/data-table-toolbar";
import { Tooltip } from "../../components/ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../components/ui/dropdown-menu";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  SortableTableHead,
  TableCell,
} from "../../components/ui/table";
import { LeadDetailSheet } from "../../components/LeadDetailSheet";
import { LeadStatusSelect } from "../../components/LeadStatusSelect";
import { INTENT_LABELS, LEAD_STATUS_LABELS, LEAD_STATUS_OPTIONS } from "../../lib/leads";

const BAND_VARIANT: Record<string, "negative" | "warning" | "neutral"> = {
  hot: "negative",
  warm: "warning",
  cold: "neutral",
};
const BAND_ICON: Record<string, typeof Flame> = { hot: Flame, warm: Thermometer, cold: Snowflake };
const BAND_LABELS: Record<string, string> = { hot: "Quente", warm: "Morno", cold: "Frio" };
const STATUS_FILTER_OPTIONS = LEAD_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
const INTENT_OPTIONS = [
  { value: "rent", label: "Alugar" },
  { value: "buy", label: "Comprar" },
  { value: "questions", label: "Só dúvidas" },
];
const BAND_OPTIONS = [
  { value: "hot", label: "Quente" },
  { value: "warm", label: "Morno" },
  { value: "cold", label: "Frio" },
];

type SortKey = "commitmentScore" | "lastSeenAt";

function ScoreExplanation({ lead }: { lead: any }) {
  const signals: { label: string; points: number }[] = lead.scoreSignals ?? [];
  if (signals.length === 0) {
    return <span className="text-ink-soft">Sem atividade suficiente para explicar a pontuação ainda.</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-ink">Por que {lead.commitmentScore} pontos?</div>
      {signals.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-3 text-ink-soft">
          <span>{s.label}</span>
          <span className="font-mono text-ink">+{s.points}</span>
        </div>
      ))}
    </div>
  );
}

export default function LeadsPage() {
  const searchParams = useSearchParams();
  const onlyIds = useMemo(() => {
    const raw = searchParams.get("ids");
    return raw ? new Set(raw.split(",")) : null;
  }, [searchParams]);
  const [leads, setLeads] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [bands, setBands] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [intents, setIntents] = useState<string[]>([]);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("commitmentScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);

  useEffect(() => {
    getLeads().then(setLeads).catch(() => setLeads([]));
  }, []);

  async function callOnWhatsapp(leadId: string) {
    const { url } = await getLeadWhatsappLink(leadId, "o que você perguntou");
    window.open(url, "_blank");
    // Opening WhatsApp moves a "Novo" lead to "Contatado" server-side — mirror it locally.
    setLeads((prev) => prev.map((l) => (l.id === leadId && l.status === "new" ? { ...l, status: "contacted" } : l)));
  }

  function handleStatusChanged(leadId: string, status: string) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    let rows = leads.filter((lead) => {
      const matchesTerm =
        !term ||
        lead.name?.toLowerCase().includes(term) ||
        lead.phone?.toLowerCase().includes(term) ||
        lead.email?.toLowerCase().includes(term) ||
        lead.waitingFor?.toLowerCase().includes(term);
      const matchesBand = bands.length === 0 || bands.includes(lead.scoreBand);
      const matchesStatus = statuses.length === 0 || statuses.includes(lead.status ?? "new");
      const matchesIntent = intents.length === 0 || intents.includes(lead.intent);
      const matchesIds = !onlyIds || onlyIds.has(lead.id);
      return matchesTerm && matchesBand && matchesStatus && matchesIntent && matchesIds;
    });
    rows = [...rows].sort((a, b) => {
      const av = sortKey === "commitmentScore" ? a.commitmentScore ?? 0 : new Date(a.lastSeenAt ?? 0).getTime();
      const bv = sortKey === "commitmentScore" ? b.commitmentScore ?? 0 : new Date(b.lastSeenAt ?? 0).getTime();
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [leads, filter, bands, statuses, intents, sortKey, sortDir, onlyIds]);

  const allSelected = filtered.length > 0 && filtered.every((lead) => selected.has(lead.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((lead) => lead.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportSelected() {
    const rows = filtered.filter((lead) => selected.has(lead.id));
    const header = ["Nome", "Telefone", "E-mail", "Intenção", "Status", "Score", "Temperatura", "Aguardando", "Última atividade"];
    const csvRows = rows.map((lead) =>
      [
        lead.name ?? "",
        lead.phone ?? "",
        lead.email ?? "",
        INTENT_LABELS[lead.intent] ?? "",
        LEAD_STATUS_LABELS[lead.status] ?? "",
        lead.commitmentScore ?? "",
        BAND_LABELS[lead.scoreBand] ?? "",
        lead.waitingFor ?? "",
        lead.lastSeenAt ? new Date(lead.lastSeenAt).toLocaleDateString("pt-BR") : "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `interessados-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Interessados</h1>
      {onlyIds && (
        <Badge variant="warning" className="mb-3">
          Mostrando apenas interessados esfriando
        </Badge>
      )}
      <Card>
        <CardContent className="p-5">
          <DataTableToolbar
            filterValue={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filtrar interessados..."
            selectionCount={selected.size}
            filters={
              <>
                <FilterDropdown label="Temperatura" options={BAND_OPTIONS} selected={bands} onChange={setBands} />
                <FilterDropdown label="Status" options={STATUS_FILTER_OPTIONS} selected={statuses} onChange={setStatuses} />
                <FilterDropdown label="Intenção" options={INTENT_OPTIONS} selected={intents} onChange={setIntents} />
              </>
            }
            actions={
              selected.size > 0 && (
                <Button variant="outline" size="sm" onClick={exportSelected}>
                  Exportar selecionados
                </Button>
              )
            }
          />
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm text-ink-soft">Nenhum interessado encontrado ainda.</p>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                      </TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Contato</TableHead>
                      <TableHead>Intenção</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Temperatura</TableHead>
                      <SortableTableHead sorted={sortKey === "commitmentScore" && sortDir} onClick={() => toggleSort("commitmentScore")}>
                        Score
                      </SortableTableHead>
                      <TableHead>Aguardando</TableHead>
                      <SortableTableHead sorted={sortKey === "lastSeenAt" && sortDir} onClick={() => toggleSort("lastSeenAt")}>
                        Última atividade
                      </SortableTableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((lead) => {
                      const BandIcon = BAND_ICON[lead.scoreBand] ?? Snowflake;
                      return (
                        <TableRow key={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)} aria-label="Selecionar interessado" />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="text-left font-medium text-ink underline-offset-2 hover:underline"
                              onClick={() => setOpenLeadId(lead.id)}
                            >
                              {lead.name ?? "—"}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono">{lead.phone}</div>
                            {lead.email && <div className="text-xs text-ink-soft">{lead.email}</div>}
                          </TableCell>
                          <TableCell>{INTENT_LABELS[lead.intent] ?? "—"}</TableCell>
                          <TableCell>
                            <LeadStatusSelect leadId={lead.id} value={lead.status ?? "new"} onChange={(status) => handleStatusChanged(lead.id, status)} />
                          </TableCell>
                          <TableCell>
                            <Tooltip content={<ScoreExplanation lead={lead} />}>
                              <Badge variant={BAND_VARIANT[lead.scoreBand]} className="gap-1">
                                <BandIcon className="h-3 w-3" />
                                {BAND_LABELS[lead.scoreBand]}
                              </Badge>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="font-mono">
                            <Tooltip content={<ScoreExplanation lead={lead} />}>
                              <span>{lead.commitmentScore}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="max-w-[16rem] text-xs text-ink-soft">
                            <span className="line-clamp-2">{lead.waitingFor ?? "—"}</span>
                          </TableCell>
                          <TableCell className="text-ink-soft">
                            {lead.lastSeenAt ? new Date(lead.lastSeenAt).toLocaleDateString("pt-BR") : "—"}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="rounded-lg p-1.5 text-ink-soft hover:bg-bg-2" aria-label="Ações">
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setOpenLeadId(lead.id)}>Ver resumo e detalhes</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => callOnWhatsapp(lead.id)}>Abrir no WhatsApp</DropdownMenuItem>
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
                <div className="mb-1 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={sortKey === "commitmentScore" ? "border-accent text-accent" : undefined}
                    onClick={() => toggleSort("commitmentScore")}
                  >
                    Score {sortKey === "commitmentScore" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={sortKey === "lastSeenAt" ? "border-accent text-accent" : undefined}
                    onClick={() => toggleSort("lastSeenAt")}
                  >
                    Última atividade {sortKey === "lastSeenAt" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </Button>
                </div>
                {filtered.map((lead) => {
                  const BandIcon = BAND_ICON[lead.scoreBand] ?? Snowflake;
                  const isSelected = selected.has(lead.id);
                  const isExpanded = expandedScoreId === lead.id;
                  return (
                    <div
                      key={lead.id}
                      data-state={isSelected ? "selected" : undefined}
                      className="rounded-lg border border-border bg-bg-2 p-3 data-[state=selected]:border-accent"
                    >
                      <div className="flex items-center gap-2">
                        <span className="-m-2 flex min-h-11 min-w-11 items-center justify-center p-2">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(lead.id)} aria-label="Selecionar interessado" />
                        </span>
                        <button type="button" className="flex-1 text-left text-sm font-medium text-ink" onClick={() => setOpenLeadId(lead.id)}>
                          {lead.name ?? "—"}
                        </button>
                        <Badge variant={BAND_VARIANT[lead.scoreBand]} className="gap-1">
                          <BandIcon className="h-3 w-3" />
                          {BAND_LABELS[lead.scoreBand]}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-mono text-ink">{lead.phone}</span>
                        <button
                          type="button"
                          className="font-mono text-ink underline-offset-2 hover:underline"
                          onClick={() => setExpandedScoreId(isExpanded ? null : lead.id)}
                        >
                          Score {lead.commitmentScore}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="mt-2 rounded-lg border border-border bg-bg px-3 py-2 text-xs">
                          <ScoreExplanation lead={lead} />
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <LeadStatusSelect leadId={lead.id} value={lead.status ?? "new"} onChange={(status) => handleStatusChanged(lead.id, status)} />
                        {lead.intent && <Badge variant="accent">{INTENT_LABELS[lead.intent]}</Badge>}
                      </div>
                      {lead.waitingFor && <div className="mt-2 text-xs text-ink">Aguardando: {lead.waitingFor}</div>}
                      <div className="mt-2 text-xs text-ink-soft">
                        Última atividade: {lead.lastSeenAt ? new Date(lead.lastSeenAt).toLocaleDateString("pt-BR") : "—"}
                      </div>
                      <Button className="mt-3 min-h-11 w-full" onClick={() => callOnWhatsapp(lead.id)}>
                        Abrir no WhatsApp
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <LeadDetailSheet
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
        onStatusChanged={handleStatusChanged}
        onOpenWhatsapp={callOnWhatsapp}
      />
    </div>
  );
}

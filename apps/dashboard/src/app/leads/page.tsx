"use client";

import { useEffect, useMemo, useState } from "react";
import { Flame, Thermometer, Snowflake, MoreHorizontal } from "lucide-react";
import { getLeads, getLeadWhatsappLink } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import { DataTableToolbar, FilterDropdown } from "../../components/ui/data-table-toolbar";
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

const BAND_VARIANT: Record<string, "negative" | "warning" | "neutral"> = {
  hot: "negative",
  warm: "warning",
  cold: "neutral",
};
const BAND_ICON: Record<string, typeof Flame> = { hot: Flame, warm: Thermometer, cold: Snowflake };
const BAND_LABELS: Record<string, string> = { hot: "Quente", warm: "Morno", cold: "Frio" };
const BAND_OPTIONS = [
  { value: "hot", label: "Quente" },
  { value: "warm", label: "Morno" },
  { value: "cold", label: "Frio" },
];

type SortKey = "commitmentScore" | "lastSeenAt";

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [bands, setBands] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("commitmentScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    getLeads().then(setLeads).catch(() => setLeads([]));
  }, []);

  async function callOnWhatsapp(leadId: string) {
    const { url } = await getLeadWhatsappLink(leadId, "o que você perguntou");
    window.open(url, "_blank");
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
      const matchesTerm = !term || lead.name?.toLowerCase().includes(term) || lead.phone?.toLowerCase().includes(term);
      const matchesBand = bands.length === 0 || bands.includes(lead.scoreBand);
      return matchesTerm && matchesBand;
    });
    rows = [...rows].sort((a, b) => {
      const av = sortKey === "commitmentScore" ? a.commitmentScore ?? 0 : new Date(a.lastSeenAt ?? 0).getTime();
      const bv = sortKey === "commitmentScore" ? b.commitmentScore ?? 0 : new Date(b.lastSeenAt ?? 0).getTime();
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [leads, filter, bands, sortKey, sortDir]);

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

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Leads</h1>
      <Card>
        <CardContent className="p-5">
          <DataTableToolbar
            filterValue={filter}
            onFilterChange={setFilter}
            filterPlaceholder="Filtrar leads..."
            selectionCount={selected.size}
            filters={<FilterDropdown label="Temperatura" options={BAND_OPTIONS} selected={bands} onChange={setBands} />}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Temperatura</TableHead>
                <SortableTableHead sorted={sortKey === "commitmentScore" && sortDir} onClick={() => toggleSort("commitmentScore")}>
                  Score
                </SortableTableHead>
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
                      <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)} aria-label="Selecionar lead" />
                    </TableCell>
                    <TableCell>{lead.name ?? "—"}</TableCell>
                    <TableCell className="font-mono">{lead.phone}</TableCell>
                    <TableCell>
                      <Badge variant={BAND_VARIANT[lead.scoreBand]} className="gap-1">
                        <BandIcon className="h-3 w-3" />
                        {BAND_LABELS[lead.scoreBand]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{lead.commitmentScore}</TableCell>
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
                          <DropdownMenuItem onSelect={() => callOnWhatsapp(lead.id)}>Abrir no WhatsApp</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

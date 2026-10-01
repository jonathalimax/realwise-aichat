"use client";

import { useEffect, useState } from "react";
import { getAnalyticsSummary, getMe } from "../lib/api";
import { KpiCard } from "../components/KpiCard";

export default function HomePage() {
  const [business, setBusiness] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    getMe().then(setBusiness).catch(() => {});
    getAnalyticsSummary().then(setSummary).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">{business?.name ?? "Seu negócio"}</h1>
        <div className="rounded-card border border-border bg-surface px-4 py-2 text-sm">
          Prontidão: <span className="font-mono font-semibold">{business?.confidenceScore ?? 0}%</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Conversas 7d" value={summary?.conversations7d ?? "—"} />
        <KpiCard label="Leads" value={summary?.leadsTotal ?? "—"} />
        <KpiCard label="Agendamentos" value={summary?.appointmentsTotal ?? "—"} />
        <KpiCard label="Aberturas do link 7d" value={summary?.linkOpens7d ?? "—"} />
      </div>
    </div>
  );
}

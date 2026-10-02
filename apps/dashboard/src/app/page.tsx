"use client";

import { useEffect, useState } from "react";
import { getAnalyticsSummary, getAnalyticsTimeseries, getMe } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ShareLink } from "../components/ShareLink";

const STATS = [
  { key: "conversations7d", label: "Conversas 7d" },
  { key: "leadsTotal", label: "Leads" },
  { key: "appointmentsTotal", label: "Agendamentos" },
  { key: "linkOpens7d", label: "Aberturas do link 7d" },
] as const;

export default function HomePage() {
  const [business, setBusiness] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);

  useEffect(() => {
    getMe().then(setBusiness).catch(() => {});
    getAnalyticsSummary().then(setSummary).catch(() => {});
    getAnalyticsTimeseries().then(setTimeseries).catch(() => setTimeseries([]));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink">{business?.name ?? "Seu negócio"}</h1>
        <Badge variant="accent" className="px-3 py-1.5 text-sm">
          Prontidão: <span className="ml-1 font-mono font-bold">{business?.confidenceScore ?? 0}%</span>
        </Badge>
      </div>
      {business?.status === "live" && <ShareLink slug={business.slug} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map(({ key, label }) => (
          <Card key={key}>
            <CardContent className="p-4">
              <div className="text-[0.7rem] uppercase tracking-wide text-ink-soft">{label}</div>
              <div className="mt-1 font-mono text-xl text-ink">{summary?.[key] ?? "—"}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Atividade (14 dias)</CardTitle>
          <CardDescription>Conversas e leads novos por dia.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart data={timeseries} />
        </CardContent>
      </Card>
    </div>
  );
}

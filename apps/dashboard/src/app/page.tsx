"use client";

import { useEffect, useState } from "react";
import { getAnalyticsSummary, getAnalyticsTimeseries, getMe } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { StatCard } from "../components/ui/stat-card";
import { SegmentedControl } from "../components/ui/segmented";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ShareLink } from "../components/ShareLink";

const STATS = [
  { key: "conversations7d", label: "Conversas 7d" },
  { key: "leadsTotal", label: "Leads" },
  { key: "appointmentsTotal", label: "Agendamentos" },
  { key: "linkOpens7d", label: "Aberturas do link 7d" },
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

export default function HomePage() {
  const [business, setBusiness] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  useEffect(() => {
    getMe().then(setBusiness).catch(() => {});
    getAnalyticsSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    getAnalyticsTimeseries(Number(range)).then(setTimeseries).catch(() => setTimeseries([]));
  }, [range]);

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
          <StatCard
            key={key}
            label={label}
            value={summary?.[key] ?? "—"}
            trend={summary ? percentDelta(summary[key] ?? 0, summary.previous?.[key] ?? 0) : undefined}
          />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Atividade</CardTitle>
          <CardAction>
            <SegmentedControl value={range} onValueChange={setRange} options={RANGE_OPTIONS} />
          </CardAction>
          <CardDescription>Conversas e leads novos por dia.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart data={timeseries} />
        </CardContent>
      </Card>
    </div>
  );
}

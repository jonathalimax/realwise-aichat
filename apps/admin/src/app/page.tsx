"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Activity, MessageSquare, UserCheck } from "lucide-react";
import { getTenants, getGlobalMetrics, getMetricsTimeseries, getConfidenceDistribution } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "../components/ui/card";
import { Badge, statusToBadgeVariant } from "../components/ui/badge";
import { StatCard } from "../components/ui/stat-card";
import { SegmentedControl } from "../components/ui/segmented";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ConfidenceDistributionChart } from "../components/charts/ConfidenceDistributionChart";

const STAT_CARDS = [
  { key: "tenantCount", label: "Tenants", icon: Users },
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
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  useEffect(() => {
    getTenants().then(setTenants).catch(() => setTenants([]));
    getGlobalMetrics().then(setMetrics).catch(() => {});
    getConfidenceDistribution().then(setDistribution).catch(() => setDistribution([]));
  }, []);

  useEffect(() => {
    getMetricsTimeseries(Number(range)).then(setTimeseries).catch(() => setTimeseries([]));
  }, [range]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <StatCard
            key={key}
            label={label}
            value={metrics?.[key] ?? "—"}
            trend={metrics ? percentDelta(metrics[key] ?? 0, metrics.previous?.[key] ?? 0) : undefined}
            icon={<Icon className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.5} />}
          />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversas</CardTitle>
            <CardAction>
              <SegmentedControl value={range} onValueChange={setRange} options={RANGE_OPTIONS} />
            </CardAction>
            <CardDescription>Volume diário de conversas iniciadas em todos os tenants.</CardDescription>
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
          <CardTitle>Tenants</CardTitle>
          <CardDescription>Todos os negócios cadastrados na plataforma.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Negócio</TableHead>
                <TableHead>Nicho</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Confiança</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/tenants/${t.id}`} className="font-semibold text-ink hover:text-accent">
                      {t.name || t.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-soft">{t.niche}</TableCell>
                  <TableCell>
                    <Badge variant={statusToBadgeVariant(t.status)}>{t.status}</Badge>
                  </TableCell>
                  <TableCell className="text-ink-soft">{t.subscription?.plan?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono">{t.confidenceScore}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

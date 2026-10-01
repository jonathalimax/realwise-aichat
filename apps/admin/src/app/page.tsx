"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Activity, MessageSquare, UserCheck } from "lucide-react";
import { getTenants, getGlobalMetrics, getMetricsTimeseries, getConfidenceDistribution } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Badge, statusToBadgeVariant } from "../components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ConfidenceDistributionChart } from "../components/charts/ConfidenceDistributionChart";

const STAT_CARDS = [
  { key: "tenantCount", label: "Tenants", icon: Users },
  { key: "liveTenantCount", label: "Ativos", icon: Activity },
  { key: "conversationCount", label: "Conversas", icon: MessageSquare },
  { key: "leadCount", label: "Leads", icon: UserCheck },
] as const;

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);

  useEffect(() => {
    getTenants().then(setTenants).catch(() => setTenants([]));
    getGlobalMetrics().then(setMetrics).catch(() => {});
    getMetricsTimeseries().then(setTimeseries).catch(() => setTimeseries([]));
    getConfidenceDistribution().then(setDistribution).catch(() => setDistribution([]));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <Card key={key}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-soft">{label}</div>
                <div className="mt-1 font-mono text-2xl text-ink">{metrics?.[key] ?? "—"}</div>
              </div>
              <Icon className="h-8 w-8 text-accent/40" strokeWidth={1.5} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversas (14 dias)</CardTitle>
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

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTenantDetail, suspendTenant } from "../../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { Badge, statusToBadgeVariant } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { StatCard } from "../../../components/ui/stat-card";
import { ConfidenceBreakdownChart } from "../../../components/charts/ConfidenceBreakdownChart";

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    getTenantDetail(params.id).then(setTenant).catch(() => {});
  }, [params.id]);

  if (!tenant) return <p className="text-ink-soft">Carregando…</p>;

  const breakdown = tenant.confidenceBreakdown ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl text-ink">{tenant.name || tenant.slug}</h1>
          <Badge variant={statusToBadgeVariant(tenant.status)}>{tenant.status}</Badge>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => suspendTenant(tenant.id).then(() => location.reload())}
        >
          Suspender
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Nicho" value={tenant.niche} />
        <StatCard label="Confiança" value={`${tenant.confidenceScore}%`} />
        <StatCard label="Plano" value={tenant.subscription?.plan?.name ?? "Sem assinatura"} />
        <StatCard
          label="Site sincronizado"
          value={tenant.websiteSyncedAt ? new Date(tenant.websiteSyncedAt).toLocaleDateString("pt-BR") : "—"}
        />
      </div>

      {Object.keys(breakdown).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Composição da confiança</CardTitle>
            <CardDescription>Como cada componente contribui para o score de prontidão.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfidenceBreakdownChart breakdown={breakdown} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

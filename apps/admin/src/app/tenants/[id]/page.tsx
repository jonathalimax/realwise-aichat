"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTenantDetail, suspendTenant } from "../../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { Badge, statusToBadgeVariant } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
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
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Nicho</div>
            <div className="mt-1 text-ink">{tenant.niche}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Confiança</div>
            <div className="mt-1 font-mono text-ink">{tenant.confidenceScore}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Plano</div>
            <div className="mt-1 text-ink">{tenant.subscription?.plan?.name ?? "Sem assinatura"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-ink-soft">Site sincronizado</div>
            <div className="mt-1 text-ink">{tenant.websiteSyncedAt ? new Date(tenant.websiteSyncedAt).toLocaleDateString("pt-BR") : "—"}</div>
          </CardContent>
        </Card>
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

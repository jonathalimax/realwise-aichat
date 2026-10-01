"use client";

import { useEffect, useState } from "react";
import { getTenantDetail, suspendTenant } from "../../../lib/api";

export default function TenantDetailPage({ params }: { params: { id: string } }) {
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    getTenantDetail(params.id).then(setTenant).catch(() => {});
  }, [params.id]);

  if (!tenant) return <p className="text-muted">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">{tenant.name || tenant.slug}</h1>
        <button
          onClick={() => suspendTenant(tenant.id).then(() => location.reload())}
          className="rounded-lg border border-negative px-3 py-1.5 text-xs font-semibold text-negative"
        >
          Suspender
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs uppercase text-muted">Nicho</div>
          <div>{tenant.niche}</div>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs uppercase text-muted">Status</div>
          <div>{tenant.status}</div>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs uppercase text-muted">Confiança</div>
          <div className="font-mono">{tenant.confidenceScore}%</div>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="text-xs uppercase text-muted">Plano</div>
          <div>{tenant.subscription?.plan?.name ?? "Sem assinatura"}</div>
        </div>
      </div>
    </div>
  );
}

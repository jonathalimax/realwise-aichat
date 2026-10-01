"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTenants, getGlobalMetrics } from "../lib/api";

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    getTenants().then(setTenants).catch(() => setTenants([]));
    getGlobalMetrics().then(setMetrics).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <div className="text-xs uppercase text-muted">Tenants</div>
          <div className="font-mono text-xl">{metrics?.tenantCount ?? "—"}</div>
        </div>
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <div className="text-xs uppercase text-muted">Ativos</div>
          <div className="font-mono text-xl">{metrics?.liveTenantCount ?? "—"}</div>
        </div>
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <div className="text-xs uppercase text-muted">Conversas</div>
          <div className="font-mono text-xl">{metrics?.conversationCount ?? "—"}</div>
        </div>
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <div className="text-xs uppercase text-muted">Leads</div>
          <div className="font-mono text-xl">{metrics?.leadCount ?? "—"}</div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted">
            <th className="pb-2">Negócio</th>
            <th className="pb-2">Nicho</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Confiança</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="py-2">
                <Link href={`/tenants/${t.id}`} className="text-accent underline">
                  {t.name || t.slug}
                </Link>
              </td>
              <td className="py-2">{t.niche}</td>
              <td className="py-2">{t.status}</td>
              <td className="py-2 font-mono">{t.confidenceScore}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

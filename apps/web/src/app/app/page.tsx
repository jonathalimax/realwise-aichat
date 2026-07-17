"use client";

import { FormEvent, useState } from "react";
import { Button, Card, StatusBadge, UsageMeter } from "@realwise/ui";
import type { DashboardSummary } from "@realwise/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

type Membership = { tenantId: string; role: string };

export default function AppDashboardPage() {
  const [email, setEmail] = useState("owner@realwise.local");
  const [password, setPassword] = useState("change-me-demo-password");
  const [tenantId, setTenantId] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const me = await request<{ memberships: Membership[] }>("/auth/me");
      const membership = me.memberships[0];
      if (!membership) throw new Error("Usuário sem tenant disponível.");
      setTenantId(membership.tenantId);
      const dashboard = await request<DashboardSummary>("/dashboard/summary", { headers: { "x-tenant-id": membership.tenantId } });
      setSummary(dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshDashboard() {
    if (!tenantId) return;
    setSummary(await request<DashboardSummary>("/dashboard/summary", { headers: { "x-tenant-id": tenantId } }));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-sm text-emerald-200">Realwise AI Chat</p>
          <h1 className="mt-2 text-3xl font-bold">Painel operacional conectado à API</h1>
          <p className="mt-2 text-slate-300">Use o seed local para entrar e validar tenant, sessão e dados reais do PostgreSQL.</p>
        </header>

        {!summary ? (
          <Card>
            <h2 className="text-xl font-semibold text-slate-950">Entrar</h2>
            <form className="mt-4 grid gap-4" onSubmit={login}>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                E-mail
                <input className="rounded-xl border border-slate-300 px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Senha
                <input className="rounded-xl border border-slate-300 px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
              <Button disabled={loading}>{loading ? "Entrando..." : "Entrar e carregar painel"}</Button>
            </form>
          </Card>
        ) : (
          <section className="space-y-6">
            <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm text-slate-500">{summary.tenant.segment}</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">{summary.tenant.name}</h2>
                <p className="mt-1 text-sm text-slate-600">Tenant: {summary.tenant.id}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={summary.health.channelsWithActionRequired > 0 ? "warning" : "ok"} />
                <Button onClick={refreshDashboard}>Atualizar</Button>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-4">
              <Metric label="Canais" value={summary.health.channelsConnected} />
              <Metric label="Ações necessárias" value={summary.health.channelsWithActionRequired} />
              <Metric label="Leads" value={summary.health.humansWaiting} />
              <Metric label="Fontes" value={summary.usage.knowledgeSources} />
            </div>

            <Card>
              <UsageMeter used={summary.usage.messagesUsed} limit={summary.usage.messagesLimit} />
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
    </Card>
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erro ${response.status}`);
  }
  return response.json() as Promise<T>;
}

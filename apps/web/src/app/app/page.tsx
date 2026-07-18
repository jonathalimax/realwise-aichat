"use client";

import { FormEvent, useState } from "react";
import { Button, Card, EmptyState, StatusBadge, UsageMeter } from "@realwise/ui";
import type { DashboardSummary, Provider } from "@realwise/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

type Membership = { tenantId: string; role: string };
type ChannelConnection = { id: string; provider: Provider; status: string; releaseState: string; externalAssetId: string | null };
type KnowledgeSource = { id: string; title: string; kind: string; releaseState: string; updatedAt: string };
type Lead = { id: string; contactName: string; service?: string; preferredTime?: string; status: string; createdAt: string };
type Billing = { plan: string; name?: string; status: string; activation: string; limits: { messagesPerMonth: number; knowledgeSources: number; teamMembers: number }; usage: { messages: number } };
type ChatwootStatus = { activation: string; releaseState: string; installation: { accountId: string; inboxId: string; status: string } | null };
type Tab = "overview" | "channels" | "knowledge" | "leads" | "billing";

type AppState = {
  tenantId: string;
  summary: DashboardSummary;
  channels: ChannelConnection[];
  knowledge: KnowledgeSource[];
  leads: Lead[];
  billing: Billing;
  chatwoot: ChatwootStatus;
};

export default function AppDashboardPage() {
  const [email, setEmail] = useState("owner@realwise.local");
  const [password, setPassword] = useState("change-me-demo-password");
  const [app, setApp] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState("Perguntas frequentes");
  const [knowledgeBody, setKnowledgeBody] = useState("A aula experimental deve ser solicitada pelo chat e confirmada pela equipe humana.");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const me = await request<{ memberships: Membership[] }>("/auth/me");
      const membership = me.memberships[0];
      if (!membership) throw new Error("Usuário sem tenant disponível.");
      setApp(await loadAppState(membership.tenantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!app) return;
    setApp(await loadAppState(app.tenantId));
  }

  async function connectMock(provider: Provider) {
    if (!app) return;
    await request("/channels/connect-mock", {
      method: "POST",
      headers: tenantHeaders(app.tenantId),
      body: JSON.stringify({ provider, externalAssetId: `mock-${provider.toLowerCase()}-web` }),
    });
    await refresh();
  }

  async function provisionChatwoot() {
    if (!app) return;
    await request("/chatwoot/provision-mock", { method: "POST", headers: tenantHeaders(app.tenantId) });
    await refresh();
  }

  async function createKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!app) return;
    await request("/knowledge/sources", {
      method: "POST",
      headers: tenantHeaders(app.tenantId),
      body: JSON.stringify({ title: knowledgeTitle, kind: "FAQ", body: knowledgeBody }),
    });
    await refresh();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-sm text-emerald-200">Realwise AI Chat</p>
          <h1 className="mt-2 text-3xl font-bold">Painel operacional</h1>
          <p className="mt-2 text-slate-300">Controle canais, conhecimento, leads, Chatwoot e limites do tenant usando a API real.</p>
        </header>

        {!app ? (
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
                <p className="text-sm text-slate-500">{app.summary.tenant.segment}</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">{app.summary.tenant.name}</h2>
                <p className="mt-1 text-sm text-slate-600">Tenant: {app.tenantId}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={app.summary.health.channelsWithActionRequired > 0 ? "warning" : "ok"} />
                <Button onClick={refresh}>Atualizar</Button>
              </div>
            </Card>

            <nav className="flex flex-wrap gap-2" aria-label="Seções do painel">
              {[
                ["overview", "Visão geral"],
                ["channels", "Canais"],
                ["knowledge", "Conhecimento"],
                ["leads", "Leads"],
                ["billing", "Cobrança"],
              ].map(([key, label]) => (
                <button key={key} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === key ? "bg-slate-950 text-white" : "bg-white text-slate-700"}`} onClick={() => setTab(key as Tab)}>
                  {label}
                </button>
              ))}
            </nav>

            {tab === "overview" ? <Overview app={app} provisionChatwoot={provisionChatwoot} /> : null}
            {tab === "channels" ? <Channels channels={app.channels} connectMock={connectMock} /> : null}
            {tab === "knowledge" ? <Knowledge sources={app.knowledge} title={knowledgeTitle} body={knowledgeBody} setTitle={setKnowledgeTitle} setBody={setKnowledgeBody} createKnowledge={createKnowledge} /> : null}
            {tab === "leads" ? <Leads leads={app.leads} /> : null}
            {tab === "billing" ? <BillingPanel billing={app.billing} /> : null}
          </section>
        )}
      </div>
    </main>
  );
}

function Overview({ app, provisionChatwoot }: { app: AppState; provisionChatwoot: () => Promise<void> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Canais" value={app.summary.health.channelsConnected} />
        <Metric label="Ações necessárias" value={app.summary.health.channelsWithActionRequired} />
        <Metric label="Leads" value={app.summary.health.humansWaiting} />
        <Metric label="Fontes" value={app.summary.usage.knowledgeSources} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold text-slate-950">Uso do plano</h3>
          <div className="mt-4"><UsageMeter used={app.billing.usage.messages} limit={app.billing.limits.messagesPerMonth || 1} /></div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Chatwoot</h3>
              <p className="mt-1 text-sm text-slate-600">{app.chatwoot.installation ? `Inbox ${app.chatwoot.installation.inboxId}` : "Ainda sem inbox mock."}</p>
            </div>
            <StatusBadge status={app.chatwoot.installation ? "ok" : "warning"} />
          </div>
          <Button className="mt-4" onClick={provisionChatwoot}>Provisionar mock</Button>
        </Card>
      </div>
    </div>
  );
}

function Channels({ channels, connectMock }: { channels: ChannelConnection[]; connectMock: (provider: Provider) => Promise<void> }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {channels.map((channel) => (
        <Card key={channel.id}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-950">{channel.provider}</h3>
            <StatusBadge status={channel.status === "CONNECTED" ? "ok" : "warning"} />
          </div>
          <p className="mt-3 text-sm text-slate-600">Estado: {channel.releaseState}</p>
          <p className="mt-1 text-sm text-slate-600">Asset: {channel.externalAssetId ?? "mock pendente"}</p>
          <Button className="mt-4" onClick={() => connectMock(channel.provider)}>Conectar mock</Button>
        </Card>
      ))}
    </div>
  );
}

function Knowledge(props: { sources: KnowledgeSource[]; title: string; body: string; setTitle: (value: string) => void; setBody: (value: string) => void; createKnowledge: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <h3 className="text-lg font-semibold text-slate-950">Nova fonte</h3>
        <form className="mt-4 grid gap-3" onSubmit={props.createKnowledge}>
          <input className="rounded-xl border border-slate-300 px-3 py-2" value={props.title} onChange={(event) => props.setTitle(event.target.value)} />
          <textarea className="min-h-32 rounded-xl border border-slate-300 px-3 py-2" value={props.body} onChange={(event) => props.setBody(event.target.value)} />
          <Button>Salvar conhecimento</Button>
        </form>
      </Card>
      <Card>
        <h3 className="text-lg font-semibold text-slate-950">Fontes aprovadas</h3>
        <div className="mt-4 grid gap-3">
          {props.sources.map((source) => (
            <div key={source.id} className="rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold text-slate-950">{source.title}</p>
              <p className="mt-1 text-sm text-slate-600">{source.kind} · {source.releaseState}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Leads({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) return <EmptyState title="Nenhum lead ainda">Leads criados pelo atendimento aparecerão aqui.</EmptyState>;
  return (
    <div className="grid gap-3">
      {leads.map((lead) => (
        <Card key={lead.id}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-950">{lead.contactName}</h3>
              <p className="mt-1 text-sm text-slate-600">{lead.service ?? "Serviço não informado"} · {lead.preferredTime ?? "Horário em aberto"}</p>
            </div>
            <StatusBadge status={lead.status === "NEW" ? "warning" : "ok"} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function BillingPanel({ billing }: { billing: Billing }) {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-950">Plano {billing.name ?? billing.plan}</h3>
      <p className="mt-1 text-sm text-slate-600">Status: {billing.status} · Ativação Stripe: {billing.activation}</p>
      <div className="mt-5"><UsageMeter used={billing.usage.messages} limit={billing.limits.messagesPerMonth || 1} /></div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Metric label="Fontes permitidas" value={billing.limits.knowledgeSources} />
        <Metric label="Membros permitidos" value={billing.limits.teamMembers} />
      </div>
    </Card>
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

async function loadAppState(tenantId: string): Promise<AppState> {
  const headers = tenantHeaders(tenantId);
  const [summary, channels, knowledge, leads, billing, chatwoot] = await Promise.all([
    request<DashboardSummary>("/dashboard/summary", { headers }),
    request<ChannelConnection[]>("/channels", { headers }),
    request<KnowledgeSource[]>("/knowledge/sources", { headers }),
    request<Lead[]>("/leads", { headers }),
    request<Billing>("/billing/entitlements", { headers }),
    request<ChatwootStatus>("/chatwoot/status", { headers }),
  ]);
  return { tenantId, summary, channels, knowledge, leads, billing, chatwoot };
}

function tenantHeaders(tenantId: string) {
  return { "x-tenant-id": tenantId };
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

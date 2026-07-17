import { Button, Card, StatusBadge, UsageMeter } from "@realwise/ui";
import type { DashboardSummary } from "@realwise/contracts";

const summary: DashboardSummary = {
  tenant: {
    id: "demo-academia",
    name: "Academia Realwise Demo",
    segment: "Academia e artes marciais",
    aiEnabled: true,
    releaseState: "MOCK_VERIFIED",
  },
  health: {
    channelsConnected: 3,
    channelsWithActionRequired: 1,
    humansWaiting: 2,
    aiPausedConversations: 1,
  },
  usage: {
    messagesUsed: 384,
    messagesLimit: 1000,
    knowledgeSources: 7,
  },
  nextActions: [
    "Conectar credenciais reais da Meta para sair do modo mock.",
    "Revisar preços e horários aprovados da academia.",
    "Responder 2 conversas aguardando humano no Chatwoot.",
  ],
};

const navigation = ["Visão geral", "Canais", "Assistente", "Conhecimento", "Leads", "Agenda", "Analytics", "Equipe", "Cobrança", "Configurações"];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <p className="text-sm text-emerald-200">Realwise</p>
            <h1 className="mt-1 text-xl font-bold">AI Chat</h1>
          </div>
          <nav className="mt-5 grid gap-1" aria-label="Principal">
            {navigation.map((item, index) => (
              <a key={item} className={`rounded-xl px-3 py-2 text-sm font-medium ${index === 0 ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50"}`} href="#">
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <section className="space-y-6">
          <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">{summary.tenant.segment}</p>
              <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{summary.tenant.name}</h2>
              <p className="mt-2 text-slate-600">Canais, IA e equipe humana em uma operação controlada.</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status="warning" />
              <Button>Ver próximas ações</Button>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-4">
            <Card><Metric label="Canais conectados" value={summary.health.channelsConnected} detail="WhatsApp, Instagram e Messenger mock" /></Card>
            <Card><Metric label="Aguardando humano" value={summary.health.humansWaiting} detail="Responder no Chatwoot" /></Card>
            <Card><Metric label="IA pausada" value={summary.health.aiPausedConversations} detail="Controle humano preservado" /></Card>
            <Card><Metric label="Fontes aprovadas" value={summary.usage.knowledgeSources} detail="Conhecimento do tenant" /></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <Card className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-950">Saúde da operação</h3>
                  <p className="text-sm text-slate-600">Mostre status e próxima ação antes de detalhes técnicos.</p>
                </div>
                <StatusBadge status="ok" />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {["WhatsApp", "Instagram Direct", "Facebook Messenger"].map((channel, index) => (
                  <div key={channel} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <strong>{channel}</strong>
                      <StatusBadge status={index === 2 ? "warning" : "ok"} />
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{index === 2 ? "Reconectar página antes do piloto." : "Mock verificado; pronto para ativação externa."}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="space-y-5">
              <h3 className="text-xl font-semibold text-slate-950">Uso e limites</h3>
              <UsageMeter used={summary.usage.messagesUsed} limit={summary.usage.messagesLimit} />
              <p className="text-sm text-slate-600">Nenhum limite é aumentado sem assinatura ou autorização explícita.</p>
            </Card>
          </div>

          <Card>
            <h3 className="text-xl font-semibold text-slate-950">Próximas ações</h3>
            <ol className="mt-4 grid gap-3">
              {summary.nextActions.map((action) => (
                <li key={action} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">{action}</li>
              ))}
            </ol>
          </Card>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

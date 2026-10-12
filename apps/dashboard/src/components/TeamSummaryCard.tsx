import { Badge } from "./ui/badge";
import type { TeamSummary } from "../lib/leads";

function formatWhen(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

// Structured, real-time summary of what the visitor wants (built from engagement events in the
// chat — selection, budget, financing questions, escalation, visit scheduled) so a human can
// close the loop with full context without reading the whole transcript.
export function TeamSummaryCard({ summary, compact = false }: { summary: TeamSummary | null | undefined; compact?: boolean }) {
  if (!summary) {
    return <p className="text-sm text-ink-soft">Ainda sem resumo — ele aparece assim que o cliente interagir (selecionar imóvel, informar orçamento, agendar…).</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent">{summary.intentLabel}</Badge>
        {summary.escalated && <Badge variant="negative">Pediu atendimento humano</Badge>}
        {summary.visit && <Badge variant="positive">Visita agendada</Badge>}
        <span className="text-xs text-ink-soft">atualizado {formatWhen(summary.updatedAt)}</span>
      </div>
      <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm text-ink">
        <span className="font-semibold">Próxima ação: </span>
        {summary.nextAction}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {summary.waitingFor && <Field label="Aguardando" value={summary.waitingFor} />}
        {summary.preferences && <Field label="Preferências" value={summary.preferences} />}
        {summary.budget && <Field label="Orçamento" value={summary.budget} />}
        {summary.financing && <Field label="Financiamento" value={summary.financing} />}
        {summary.visit && (
          <Field
            label="Visita"
            value={`${formatWhen(summary.visit.startsAt)}${summary.visit.listingTitle ? ` — ${summary.visit.listingTitle}` : ""}${
              summary.visit.alternatives.length ? ` (alternativas: ${summary.visit.alternatives.map(formatWhen).join(", ")})` : ""
            }`}
          />
        )}
      </dl>
      {summary.rankedListings.length > 0 && (
        <div>
          <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">Imóveis de interesse (mais interessado primeiro)</div>
          <ol className="flex flex-col gap-1">
            {summary.rankedListings.slice(0, compact ? 3 : 8).map((l, i) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm text-ink">
                <span className="min-w-0 truncate">
                  {i + 1}. {l.title}
                </span>
                {l.selected && <Badge variant="positive">Selecionado</Badge>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {summary.unanswered.length > 0 && (
        <Field label="Perguntas sem resposta" value={summary.unanswered.join(" · ")} />
      )}
      {!compact && summary.recentEvents.length > 0 && (
        <div>
          <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">Linha do tempo</div>
          <ul className="flex flex-col gap-1">
            {summary.recentEvents
              .slice()
              .reverse()
              .map((e, i) => (
                <li key={`${e.at}-${i}`} className="text-xs text-ink-soft">
                  <span className="font-mono">{formatWhen(e.at)}</span> — {e.label}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

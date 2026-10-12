"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getLeadDetail, updateLeadNotes } from "../lib/api";
import { INTENT_LABELS, LEAD_STATUS_LABELS, statusBadgeVariant, type TeamSummary } from "../lib/leads";
import { Sheet, SheetContent } from "./ui/sheet";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { TeamSummaryCard } from "./TeamSummaryCard";
import { LeadStatusSelect } from "./LeadStatusSelect";

function formatDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

// Full lead context for the team: contact, lifecycle status (incl. "Fechado — vendido/alugado"),
// temperature + why, the real-time team summary, properties of interest, visits and notes.
export function LeadDetailSheet({
  leadId,
  onClose,
  onStatusChanged,
  onOpenWhatsapp,
}: {
  leadId: string | null;
  onClose: () => void;
  onStatusChanged: (leadId: string, status: string) => void;
  onOpenWhatsapp: (leadId: string) => void;
}) {
  const [lead, setLead] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLead(null);
    setError(null);
    getLeadDetail(leadId)
      .then((data) => {
        if (cancelled) return;
        setLead(data);
        setNotes(data.ownerNotes ?? "");
      })
      .catch(() => !cancelled && setError("Não consegui carregar este interessado."));
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function saveNotes() {
    if (!leadId) return;
    setSavingNotes(true);
    try {
      await updateLeadNotes(leadId, notes);
    } catch {
      setError("Não consegui salvar as anotações.");
    } finally {
      setSavingNotes(false);
    }
  }

  const summary: TeamSummary | null = lead?.summary ?? null;
  const signals: { label: string; points: number }[] = lead?.scoreSignals ?? [];

  return (
    <Sheet open={Boolean(leadId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto p-5 sm:w-[32rem]">
        <Dialog.Title className="pr-10 font-serif text-xl text-ink">{lead?.name ?? "Interessado"}</Dialog.Title>
        <Dialog.Description className="sr-only">Detalhes, resumo e status do interessado</Dialog.Description>
        {error && <p className="mt-3 rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
        {!lead && !error && <p className="mt-4 text-sm text-ink-soft">Carregando…</p>}
        {lead && (
          <div className="mt-4 flex flex-col gap-5">
            <section className="flex flex-col gap-1 text-sm text-ink">
              <div className="font-mono">{lead.phone}</div>
              {lead.email && <div>{lead.email}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(lead.status)}>{LEAD_STATUS_LABELS[lead.status] ?? lead.status}</Badge>
                {lead.intent && <Badge variant="accent">{INTENT_LABELS[lead.intent] ?? lead.intent}</Badge>}
                <span className="text-xs text-ink-soft">desde {formatDate(lead.firstSeenAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LeadStatusSelect
                  leadId={lead.id}
                  value={lead.status}
                  onChange={(status) => {
                    setLead((prev: any) => ({ ...prev, status }));
                    onStatusChanged(lead.id, status);
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => onOpenWhatsapp(lead.id)}>
                  Abrir no WhatsApp
                </Button>
              </div>
              {lead.closedAt && (
                <p className="mt-1 text-xs text-ink-soft">
                  Fechado em {formatDate(lead.closedAt)} — continua guardado aqui para follow-up e novas oportunidades.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">Resumo para o time</h3>
              <TeamSummaryCard summary={summary} />
            </section>

            {lead.waitingFor && (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-ink">Está aguardando</h3>
                <p className="text-sm text-ink">{lead.waitingFor}</p>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-sm font-semibold text-ink">
                Temperatura: {lead.scoreBand === "hot" ? "Quente" : lead.scoreBand === "warm" ? "Morno" : "Frio"} ({lead.commitmentScore})
              </h3>
              {signals.length === 0 ? (
                <p className="text-sm text-ink-soft">Pouca atividade até agora.</p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-sm text-ink-soft">
                  {signals.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{s.label}</span>
                      <span className="font-mono text-ink">+{s.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {lead.interestListings?.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-ink">Imóveis de interesse</h3>
                <ol className="flex flex-col gap-1 text-sm text-ink">
                  {lead.interestListings.map((l: any, i: number) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {i + 1}. {l.title} {l.referenceCode && <span className="text-ink-soft">({l.referenceCode})</span>}
                      </span>
                      {l.status !== "active" && <Badge variant="neutral">{l.status}</Badge>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {lead.appointments?.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-ink">Visitas</h3>
                <ul className="flex flex-col gap-1 text-sm text-ink">
                  {lead.appointments.map((a: any) => (
                    <li key={a.id}>
                      {formatDate(a.startsAt)} — {a.serviceName} <span className="text-ink-soft">({a.status})</span>
                      {a.notes && <div className="text-xs text-ink-soft">{a.notes}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-sm font-semibold text-ink">Anotações do time</h3>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Ex.: ligar quando entrar casa de 3 quartos no Centro" />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? "Salvando…" : "Salvar anotações"}
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { maskBrPhone, digitsOnly } from "@realwise/shared";
import { bookAppointment, getScheduleOptions, type ScheduleOptions, type ScheduleSlot } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_OPTIONS = 3;

export interface BookedVisit {
  serviceName: string;
  startsAt: string;
  alternatives: string[];
  listingTitle: string | null;
}

type Step = "pick" | "contact";

// Visit scheduling card: (1) day bubbles — only days the business attends, from its configured
// availability; (2) that day's open time slots, where the visitor can mark up to 3 date+time
// options across days; (3) a contact card (name, e-mail, WhatsApp) shown only when this contact
// hasn't been captured yet — never asked again afterwards.
export function SchedulePicker({
  businessId,
  conversationId,
  niche,
  businessName,
  contactCaptured,
  onIdentify,
  onBooked,
  onClose,
  onError,
}: {
  businessId: string;
  conversationId: string;
  niche: string;
  businessName: string;
  contactCaptured: boolean;
  onIdentify: (name: string, phone: string, email: string) => Promise<void>;
  onBooked: (visit: BookedVisit) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const serviceName = niche === "concessionaria" ? "Test-drive" : "Visita ao imóvel";
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ScheduleSlot[]>([]);
  const [step, setStep] = useState<Step>("pick");
  const [submitting, setSubmitting] = useState(false);
  // Free-text fallback when the business hasn't configured availability yet.
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function load() {
    setLoadFailed(false);
    try {
      const result = await getScheduleOptions(businessId, conversationId);
      setOptions(result);
      setActiveDay(result.days[0]?.dateKey ?? null);
      setChosen((prev) => prev.filter((c) => result.days.some((d) => d.slots.some((s) => s.startsAt === c.startsAt))));
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, conversationId]);

  const needsContact = !contactCaptured && !options?.hasContact;
  const day = useMemo(() => options?.days.find((d) => d.dateKey === activeDay) ?? options?.days[0], [options, activeDay]);
  const usingManual = options !== null && !options.configured;
  const canContinue = usingManual ? Boolean(manualDate && manualTime) : chosen.length > 0;
  const phoneDigits = digitsOnly(phone).length;
  const contactValid = name.trim().length >= 2 && EMAIL_PATTERN.test(email.trim()) && (phoneDigits === 10 || phoneDigits === 11);

  function toggleSlot(slot: ScheduleSlot) {
    setChosen((prev) => {
      if (prev.some((c) => c.startsAt === slot.startsAt)) return prev.filter((c) => c.startsAt !== slot.startsAt);
      if (prev.length >= MAX_OPTIONS) return prev;
      return [...prev, slot].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    });
  }

  function dayLabelFor(slot: ScheduleSlot) {
    const owner = options?.days.find((d) => d.slots.some((s) => s.startsAt === slot.startsAt));
    return `${owner?.label ?? ""} às ${slot.label}`;
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (needsContact) {
        try {
          await onIdentify(name.trim(), phone, email.trim());
        } catch (err) {
          const status = (err as { status?: number })?.status;
          onError(typeof status === "number" && status >= 400 && status < 500 ? "Verifica seu e-mail e WhatsApp e tenta de novo." : "Não consegui salvar seus dados — tenta de novo.");
          return;
        }
      }
      let primary: { startsAt: string; endsAt: string };
      let alternatives: { startsAt: string; endsAt: string }[] = [];
      if (usingManual) {
        const start = new Date(`${manualDate}T${manualTime}:00`);
        primary = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60 * 1000).toISOString() };
      } else {
        [primary, ...alternatives] = chosen.map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt }));
      }
      let result: any;
      try {
        result = await bookAppointment(businessId, conversationId, serviceName, primary.startsAt, primary.endsAt, alternatives);
      } catch {
        onError("Não consegui confirmar esse horário — ele pode ter sido ocupado. Escolhe outro?");
        setStep("pick");
        void load();
        return;
      }
      if (result?.slotUnavailable || (result?.message && !result?.id)) {
        onError(result?.message?.content ?? "Esse horário acabou de ficar indisponível — escolhe outro, por favor?");
        setStep("pick");
        void load();
        return;
      }
      onBooked({
        serviceName,
        startsAt: result?.startsAt ?? primary.startsAt,
        alternatives: (result?.alternatives ?? []).map((a: { startsAt: string }) => a.startsAt),
        listingTitle: result?.listing?.title ?? options?.listing?.title ?? null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const title = niche === "concessionaria" ? "Agendar test-drive" : "Agendar visita";

  return (
    <Card className="mt-3 w-full max-w-[min(100%,26rem)]">
      <CardContent className="p-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-ink-soft">{title}</div>
        {options?.listing && <div className="mb-2 text-sm font-semibold text-ink">{options.listing.title}</div>}

        {options === null && !loadFailed && <p className="text-sm text-ink-soft">Carregando horários…</p>}
        {loadFailed && (
          <div>
            <p className="text-sm text-ink-soft">Não consegui carregar os horários agora.</p>
            <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => void load()}>
              Tentar de novo
            </Button>
          </div>
        )}

        {options && step === "pick" && options.configured && options.days.length === 0 && (
          <div>
            <p className="text-sm text-ink-soft">Não tenho horários abertos nos próximos 14 dias — me conta qual dia funciona pra você?</p>
            <Button type="button" variant="outline" className="mt-2 w-full" onClick={onClose}>
              Fechar
            </Button>
          </div>
        )}

        {options && step === "pick" && options.configured && options.days.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-ink-soft">Escolha o dia:</p>
            <div className="flex w-full snap-x gap-2 overflow-x-auto overscroll-x-contain pb-1" role="tablist" aria-label="Dias disponíveis">
              {options.days.map((d) => {
                const isActive = d.dateKey === day?.dateKey;
                const chosenCount = chosen.filter((c) => d.slots.some((s) => s.startsAt === c.startsAt)).length;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveDay(d.dateKey)}
                    className={
                      (isActive
                        ? "tenant-accent-bg text-white"
                        : "tenant-accent-border tenant-accent-text bg-surface") +
                      " min-h-11 shrink-0 snap-start rounded-full border px-4 py-2 text-sm font-medium transition-transform active:scale-[0.98]"
                    }
                  >
                    {d.label}
                    {chosenCount > 0 ? ` · ${chosenCount}` : ""}
                  </button>
                );
              })}
            </div>
            {day && (
              <>
                <p className="mb-2 mt-3 text-xs text-ink-soft">
                  Horários de {day.label} — toque para marcar (até {MAX_OPTIONS} opções):
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {day.slots.map((slot) => {
                    const isChosen = chosen.some((c) => c.startsAt === slot.startsAt);
                    const disabled = !isChosen && chosen.length >= MAX_OPTIONS;
                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        aria-pressed={isChosen}
                        disabled={disabled}
                        onClick={() => toggleSlot(slot)}
                        className={
                          (isChosen ? "tenant-accent-bg text-white" : "tenant-accent-border tenant-accent-text bg-surface") +
                          " min-h-11 rounded-xl border px-2 py-2 text-sm font-medium transition-transform active:scale-[0.98] disabled:opacity-40"
                        }
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {chosen.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ink">
                {chosen.map((c, i) => (
                  <li key={c.startsAt}>
                    {i === 0 ? "1ª opção" : `${i + 1}ª opção`}: {dayLabelFor(c)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {options && step === "pick" && usingManual && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input type="date" aria-label="Data" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
            <Input type="time" aria-label="Horário" value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
          </div>
        )}

        {options && step === "pick" && (usingManual || options.days.length > 0) && (
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="min-h-11 flex-1"
              disabled={!canContinue || submitting}
              onClick={() => (needsContact ? setStep("contact") : void submit())}
            >
              {needsContact ? "Continuar" : submitting ? "Confirmando…" : "Confirmar visita"}
            </Button>
          </div>
        )}

        {step === "contact" && (
          <div>
            <p className="text-sm text-ink">Pra confirmar, me passa seus dados (só vou pedir uma vez):</p>
            <Input className="mt-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoComplete="name" aria-label="Nome" />
            <Input
              className="mt-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="E-mail"
            />
            {email.length > 0 && !EMAIL_PATTERN.test(email.trim()) && <p className="mt-1 text-xs text-negative">Digite um e-mail válido.</p>}
            <Input
              className="mt-2"
              value={phone}
              onChange={(e) => setPhone(maskBrPhone(e.target.value))}
              placeholder="WhatsApp (11) 99999-9999"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              aria-label="WhatsApp"
            />
            <p className="mt-2 text-[0.7rem] text-ink-soft">
              Ao confirmar, você concorda em compartilhar seu nome, e-mail e WhatsApp com {businessName} para este atendimento.
            </p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setStep("pick")}>
                Voltar
              </Button>
              <Button type="button" className="min-h-11 flex-1" disabled={!contactValid || submitting} onClick={() => void submit()}>
                {submitting ? "Confirmando…" : "Confirmar visita"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

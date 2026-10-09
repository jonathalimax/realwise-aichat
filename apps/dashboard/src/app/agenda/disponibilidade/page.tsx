"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  getAvailabilityRules,
  upsertAvailabilityRule,
  deleteAvailabilityRule,
  getListings,
} from "../../../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";

type AppointmentType = "presencial" | "remoto" | "visita_local";

const APPOINTMENT_TYPES: { value: AppointmentType; label: string }[] = [
  { value: "presencial", label: "Presencial" },
  { value: "remoto", label: "Remoto" },
  { value: "visita_local", label: "Visita ao local" },
];

const WEEKDAYS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
];

function weekdayLabel(weekday: number | null) {
  return WEEKDAYS.find((w) => w.value === weekday)?.label ?? "—";
}

export default function DisponibilidadePage() {
  const [rules, setRules] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<AppointmentType>("presencial");

  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60);
  const [capacity, setCapacity] = useState(1);
  const [listingId, setListingId] = useState<string>("");

  const [blackoutDate, setBlackoutDate] = useState("");

  async function refresh() {
    setLoading(true);
    const [r, l] = await Promise.all([getAvailabilityRules().catch(() => []), getListings().catch(() => [])]);
    setRules(r);
    setListings(l);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const recurringRules = useMemo(
    () => rules.filter((r) => r.kind === "recurring" && r.appointmentType === activeType),
    [rules, activeType],
  );
  const blackoutRules = useMemo(() => rules.filter((r) => r.kind === "exception" && r.isBlocked), [rules]);

  function toggleWeekday(value: number) {
    setWeekdays((prev) => (prev.includes(value) ? prev.filter((w) => w !== value) : [...prev, value]));
  }

  async function addRule() {
    if (weekdays.length === 0) return;
    await Promise.all(
      weekdays.map((weekday) =>
        upsertAvailabilityRule({
          appointmentType: activeType,
          weekday,
          startTime,
          endTime,
          slotDurationMinutes,
          capacity,
          listingId: activeType === "visita_local" && listingId ? listingId : null,
          kind: "recurring",
        }),
      ),
    );
    refresh();
  }

  async function removeRule(id: string) {
    await deleteAvailabilityRule(id);
    refresh();
  }

  async function addBlackout() {
    if (!blackoutDate) return;
    await upsertAvailabilityRule({
      appointmentType: activeType,
      kind: "exception",
      isBlocked: true,
      exceptionDate: blackoutDate,
      slotDurationMinutes: 60,
    });
    setBlackoutDate("");
    refresh();
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/agenda" className="shrink-0 text-ink-soft hover:text-ink">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="min-w-0 font-serif text-2xl text-ink">Configurar disponibilidade</h1>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {APPOINTMENT_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setActiveType(t.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              activeType === t.value ? "bg-accent text-white" : "border border-border text-ink-soft hover:bg-bg-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Horários recorrentes — {APPOINTMENT_TYPES.find((t) => t.value === activeType)?.label}</CardTitle>
            <CardDescription>Dias e horários em que a Clara pode oferecer agendamento deste tipo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            {activeType === "visita_local" && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">
                  Horários específicos para um anúncio (opcional)
                </label>
                <select
                  value={listingId}
                  onChange={(e) => setListingId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm text-ink outline-none focus:border-ink/40"
                >
                  <option value="">Regra geral (todos os anúncios)</option>
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Dias da semana</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => toggleWeekday(w.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      weekdays.includes(w.value)
                        ? "bg-accent text-white"
                        : "border border-border text-ink-soft hover:bg-bg-2"
                    }`}
                  >
                    {w.label.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Início</label>
                <Input type="time" step={60} lang="en-GB" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Fim</label>
                <Input type="time" step={60} lang="en-GB" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Duração (min)</label>
                <Input
                  type="number"
                  min={15}
                  step={15}
                  value={slotDurationMinutes}
                  onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                  className="no-spinner"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Capacidade por horário</label>
                <Input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="no-spinner w-20"
                />
              </div>
              <Button size="sm" onClick={addRule} className="ml-auto" disabled={weekdays.length === 0}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {recurringRules.length === 0 && !loading && (
                <p className="text-sm text-ink-soft">Nenhum horário configurado para este tipo ainda.</p>
              )}
              {recurringRules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="font-medium text-ink">{weekdayLabel(r.weekday)}</span>
                    <span className="text-ink-soft">
                      {r.startTime}–{r.endTime} · {r.slotDurationMinutes}min · cap. {r.capacity}
                    </span>
                    {r.listingId && (
                      <Badge variant="accent">
                        {listings.find((l) => l.id === r.listingId)?.title ?? "Anúncio específico"}
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={() => removeRule(r.id)}
                    aria-label="Remover"
                    className="-m-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2 text-ink-soft hover:text-negative"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dias bloqueados</CardTitle>
            <CardDescription>Datas em que nada fica disponível para agendamento, independente das regras acima.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="flex items-center gap-2">
              <Input type="date" value={blackoutDate} onChange={(e) => setBlackoutDate(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={addBlackout}>
                <Plus className="h-4 w-4" /> Bloquear
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {blackoutRules.filter((r) => r.appointmentType === activeType).length === 0 && !loading && (
                <p className="text-sm text-ink-soft">Nenhum dia bloqueado para este tipo.</p>
              )}
              {blackoutRules
                .filter((r) => r.appointmentType === activeType)
                .map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-ink">
                      {r.exceptionDate ? new Date(r.exceptionDate).toLocaleDateString("pt-BR") : "—"}
                    </span>
                    <button
                      onClick={() => removeRule(r.id)}
                      aria-label="Remover"
                      className="-m-2 flex min-h-11 min-w-11 items-center justify-center p-2 text-ink-soft hover:text-negative"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

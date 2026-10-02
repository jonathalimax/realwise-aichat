"use client";

import { useEffect, useMemo, useState } from "react";
import { getAppointments, updateAppointmentStatus, getMe, getCalendarStatus, getCalendarAuthUrl } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  canceled: "Cancelado",
  no_show: "Não compareceu",
  completed: "Concluído",
};

const STATUS_VARIANT: Record<string, "neutral" | "positive" | "negative" | "warning"> = {
  pending: "warning",
  confirmed: "positive",
  canceled: "negative",
  no_show: "negative",
  completed: "neutral",
};

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const grid = new Date(first);
  grid.setDate(first.getDate() - first.getDay());
  return grid;
}

export default function AgendaPage() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarConfigured, setCalendarConfigured] = useState(true);

  async function refresh() {
    setAppointments(await getAppointments());
  }

  async function refreshCalendarStatus() {
    const business = await getMe();
    const status = await getCalendarStatus(business.id);
    setCalendarConnected(Boolean(status.connected));
  }

  async function connectCalendar() {
    const business = await getMe();
    const result = await getCalendarAuthUrl(business.id);
    if (!result.configured) {
      setCalendarConfigured(false);
      return;
    }
    window.location.href = result.url;
  }

  useEffect(() => {
    refresh();
    refreshCalendarStatus();
  }, []);

  async function setStatus(id: string, status: string) {
    await updateAppointmentStatus(id, status);
    refresh();
  }

  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const a of appointments) {
      const key = dayKey(new Date(a.startsAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [appointments]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const cells = useMemo(() => {
    const start = startOfMonthGrid(year, month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [year, month]);

  const visible = selectedDay ? byDay.get(selectedDay) ?? [] : appointments;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Agenda</h1>
        <div className="flex items-center gap-2">
          {calendarConnected ? (
            <Badge variant="positive">Google Calendar conectado</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={connectCalendar}>
              Conectar Google Calendar
            </Button>
          )}
          {!calendarConfigured && (
            <span className="text-xs text-ink-soft">Integração ainda não configurada pelo time.</span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}>
                ‹
              </Button>
              <div className="text-sm font-semibold capitalize text-ink">{monthLabel}</div>
              <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}>
                ›
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[0.7rem] text-ink-soft">
              {WEEKDAYS.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                const key = dayKey(d);
                const inMonth = d.getMonth() === month;
                const count = byDay.get(key)?.length ?? 0;
                const isSelected = selectedDay === key;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDay(isSelected ? null : key)}
                    className={`flex h-10 flex-col items-center justify-center rounded-lg text-xs ${
                      isSelected ? "bg-accent text-white" : inMonth ? "text-ink hover:bg-surface" : "text-ink-soft/40"
                    }`}
                  >
                    <span>{d.getDate()}</span>
                    {count > 0 && (
                      <span
                        className={`mt-0.5 h-1 w-1 rounded-full ${isSelected ? "bg-white" : "bg-accent"}`}
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {selectedDay && (
              <button onClick={() => setSelectedDay(null)} className="mt-3 text-xs text-ink-soft underline">
                Ver todos os agendamentos
              </button>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {visible.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-ink">{a.serviceName}</div>
                  <div className="text-xs text-ink-soft">{new Date(a.startsAt).toLocaleString("pt-BR")}</div>
                  {a.lead && (
                    <div className="text-xs text-ink-soft">
                      {a.lead.name || "Sem nome"} · {a.lead.phone}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  {a.status === "pending" && (
                    <Button size="sm" onClick={() => setStatus(a.id, "confirmed")}>
                      Confirmar
                    </Button>
                  )}
                  {a.status !== "canceled" && a.status !== "completed" && (
                    <Button size="sm" variant="destructive" onClick={() => setStatus(a.id, "canceled")}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {visible.length === 0 && (
            <p className="text-sm text-ink-soft">
              {selectedDay ? "Nenhum agendamento neste dia." : "Nenhum agendamento ainda."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

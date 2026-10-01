"use client";

import { useEffect, useState } from "react";
import { getAppointments, updateAppointmentStatus } from "../../lib/api";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  canceled: "Cancelado",
  no_show: "Não compareceu",
  completed: "Concluído",
};

export default function AgendaPage() {
  const [appointments, setAppointments] = useState<any[]>([]);

  async function refresh() {
    setAppointments(await getAppointments());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setStatus(id: string, status: string) {
    await updateAppointmentStatus(id, status);
    refresh();
  }

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Agenda</h1>
      <div className="flex flex-col gap-2">
        {appointments.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <div>
              <div className="font-semibold">{a.serviceName}</div>
              <div className="text-xs text-muted">{new Date(a.startsAt).toLocaleString("pt-BR")}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{STATUS_LABEL[a.status]}</span>
              {a.status === "pending" && (
                <button onClick={() => setStatus(a.id, "confirmed")} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white">
                  Confirmar
                </button>
              )}
              {a.status !== "canceled" && a.status !== "completed" && (
                <button onClick={() => setStatus(a.id, "canceled")} className="rounded-lg border border-negative px-3 py-1 text-xs text-negative">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        ))}
        {appointments.length === 0 && <p className="text-sm text-muted">Nenhum agendamento ainda.</p>}
      </div>
    </div>
  );
}

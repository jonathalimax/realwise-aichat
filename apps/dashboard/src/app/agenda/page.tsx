"use client";

import { useEffect, useState } from "react";
import { getAppointments, updateAppointmentStatus } from "../../lib/api";
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
      <div className="flex flex-col gap-3">
        {appointments.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-ink">{a.serviceName}</div>
                <div className="text-xs text-ink-soft">{new Date(a.startsAt).toLocaleString("pt-BR")}</div>
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
        {appointments.length === 0 && <p className="text-sm text-ink-soft">Nenhum agendamento ainda.</p>}
      </div>
    </div>
  );
}

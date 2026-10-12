// Lead lifecycle. Automatic transitions only ever move a lead FORWARD from the early stages (a
// visit booked in chat, the owner opening WhatsApp) and never touch a status the business set by
// hand past that point — in particular a closed lead is never reopened automatically. Closed
// leads are retained (never deleted) so the business can follow up / upsell later.

export const LEAD_STATUSES = ["new", "contacted", "visit_scheduled", "negotiating", "closed_won", "closed_lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Novo",
  contacted: "Contatado",
  visit_scheduled: "Visita agendada",
  negotiating: "Em negociação",
  closed_won: "Fechado (vendido/alugado)",
  closed_lost: "Perdido",
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isClosedStatus(status: string | null | undefined): boolean {
  return status === "closed_won" || status === "closed_lost";
}

export type LeadStatusTrigger = "visit_scheduled" | "owner_contacted";

export function nextLeadStatus(current: string | null | undefined, trigger: LeadStatusTrigger): LeadStatus | null {
  const status: LeadStatus = isLeadStatus(current) ? current : "new";
  if (trigger === "visit_scheduled" && (status === "new" || status === "contacted")) return "visit_scheduled";
  if (trigger === "owner_contacted" && status === "new") return "contacted";
  return null;
}

// Columns to write when the business sets a status by hand. Keeps the legacy ownerOutcome column
// (won/lost) consistent and stamps closedAt only on the transition into a closed state.
export function statusUpdateFields(
  current: { status?: string | null; closedAt?: Date | null },
  next: LeadStatus,
  now: Date = new Date(),
): { status: LeadStatus; statusUpdatedAt: Date; closedAt: Date | null; ownerOutcome?: string | null } {
  const closing = isClosedStatus(next);
  return {
    status: next,
    statusUpdatedAt: now,
    closedAt: closing ? (isClosedStatus(current.status) && current.closedAt ? current.closedAt : now) : null,
    ...(next === "closed_won"
      ? { ownerOutcome: "won" }
      : next === "closed_lost"
        ? { ownerOutcome: "lost" }
        : isClosedStatus(current.status)
          ? { ownerOutcome: null }
          : {}),
  };
}

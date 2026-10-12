// Mirrors apps/api/src/modules/leads/lead-status.ts and engagement-summary.ts (dashboard copy).

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contatado" },
  { value: "visit_scheduled", label: "Visita agendada" },
  { value: "negotiating", label: "Em negociação" },
  { value: "closed_won", label: "Fechado (vendido/alugado)" },
  { value: "closed_lost", label: "Perdido" },
] as const;

export const LEAD_STATUS_LABELS: Record<string, string> = Object.fromEntries(LEAD_STATUS_OPTIONS.map((o) => [o.value, o.label]));

export const INTENT_LABELS: Record<string, string> = { rent: "Alugar", buy: "Comprar", questions: "Só dúvidas" };

export function statusBadgeVariant(status: string): "positive" | "negative" | "warning" | "accent" | "neutral" | "secondary" {
  switch (status) {
    case "closed_won":
      return "positive";
    case "closed_lost":
      return "negative";
    case "visit_scheduled":
      return "accent";
    case "negotiating":
      return "warning";
    case "contacted":
      return "secondary";
    default:
      return "neutral";
  }
}

export interface TeamSummary {
  intent: string | null;
  intentLabel: string;
  headline: string;
  rankedListings: { id: string; title: string; interest: number; selected: boolean }[];
  preferences: string | null;
  budget: string | null;
  financing: string | null;
  waitingFor: string | null;
  nextAction: string;
  escalated: boolean;
  visit: { startsAt: string; alternatives: string[]; listingTitle?: string | null } | null;
  unanswered: string[];
  recentEvents: { at: string; label: string }[];
  updatedAt: string;
}

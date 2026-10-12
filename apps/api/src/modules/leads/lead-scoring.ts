export interface ScoreSignal {
  label: string;
  points: number;
}

export interface LeadSignalInputs {
  hasNameAndPhone: boolean;
  messageCount: number;
  askedPrice: boolean;
  askedAvailability: boolean;
  // Any non-canceled appointment (a visit scheduled in chat starts as "pending").
  startedBooking: boolean;
  // Owner confirmed it, or the visit already happened.
  completedBooking: boolean;
  askedLocation: boolean;
  askedPaymentOrFinancing: boolean;
  requestedEscalation: boolean;
  isReturningVisitor: boolean;
  sentDocument: boolean;
  askedSpecificItem: boolean;
  weeksSinceLastActivity: number;
  // Explicitly tapped "Selecionar" on at least one listing.
  selectedListing?: boolean;
  // Stated a budget / price ceiling.
  statedBudget?: boolean;
}

export type LeadBand = "hot" | "warm" | "cold";

export const HOT_THRESHOLD = 70;
export const WARM_THRESHOLD = 40;

// Signals are stored on the lead (Lead.scoreSignals) as the human-readable reason behind the
// temperature — the dashboard shows them as "why is this lead hot?".
export function computeLeadScore(input: LeadSignalInputs): { score: number; band: LeadBand; signals: ScoreSignal[] } {
  const signals: ScoreSignal[] = [];
  const add = (label: string, condition: boolean | undefined, points: number) => {
    if (condition) signals.push({ label, points });
  };

  add("Agendou visita", input.startedBooking, 40);
  add("Visita confirmada/realizada", input.completedBooking, 15);
  add("Selecionou imóvel", input.selectedListing, 15);
  add("Pediu para falar com humano", input.requestedEscalation, 15);
  add("Informou orçamento", input.statedBudget, 10);
  add("Forneceu nome e telefone", input.hasNameAndPhone, 10);
  add("Perguntou sobre preço", input.askedPrice, 10);
  add("Perguntou sobre disponibilidade", input.askedAvailability, 10);
  add("Perguntou sobre pagamento/financiamento", input.askedPaymentOrFinancing, 10);
  add("Visitante recorrente", input.isReturningVisitor, 10);
  add("Enviou documento", input.sentDocument, 18);
  add("Perguntou sobre item específico", input.askedSpecificItem, 8);
  add("Perguntou sobre localização", input.askedLocation, 6);
  add("5+ mensagens trocadas", input.messageCount >= 5, 8);
  add("10+ mensagens trocadas", input.messageCount >= 10, 5);

  let raw = signals.reduce((sum, s) => sum + s.points, 0);
  const decay = Math.pow(0.85, Math.max(0, input.weeksSinceLastActivity));
  raw = Math.min(100, Math.round(raw * decay));

  const band: LeadBand = raw >= HOT_THRESHOLD ? "hot" : raw >= WARM_THRESHOLD ? "warm" : "cold";
  return { score: raw, band, signals: [...signals].sort((a, b) => b.points - a.points) };
}

// One-line reason for the temperature, from the strongest signals.
export function temperatureReason(signals: ScoreSignal[], limit = 3): string {
  if (signals.length === 0) return "Pouca atividade até agora";
  return [...signals]
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
    .map((s) => s.label)
    .join(" · ");
}

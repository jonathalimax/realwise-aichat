export interface ScoreSignal {
  label: string;
  points: number;
}

export interface LeadSignalInputs {
  hasNameAndPhone: boolean;
  messageCount: number;
  askedPrice: boolean;
  askedAvailability: boolean;
  startedBooking: boolean;
  completedBooking: boolean;
  askedLocation: boolean;
  askedPaymentOrFinancing: boolean;
  requestedEscalation: boolean;
  isReturningVisitor: boolean;
  sentDocument: boolean;
  askedSpecificItem: boolean;
  weeksSinceLastActivity: number;
}

export function computeLeadScore(input: LeadSignalInputs): { score: number; band: "hot" | "warm" | "cold"; signals: ScoreSignal[] } {
  const signals: ScoreSignal[] = [];
  const add = (label: string, condition: boolean, points: number) => {
    if (condition) signals.push({ label, points });
  };

  add("Forneceu nome e telefone", input.hasNameAndPhone, 10);
  add("5+ mensagens trocadas", input.messageCount >= 5, 10);
  add("10+ mensagens trocadas", input.messageCount >= 10, 5);
  add("Perguntou sobre preço", input.askedPrice, 12);
  add("Perguntou sobre disponibilidade", input.askedAvailability, 12);
  add("Iniciou agendamento", input.startedBooking, 20);
  add("Completou agendamento", input.completedBooking, 25);
  add("Perguntou sobre localização", input.askedLocation, 8);
  add("Perguntou sobre pagamento/financiamento", input.askedPaymentOrFinancing, 10);
  add("Pediu para falar com humano", input.requestedEscalation, 15);
  add("Visitante recorrente", input.isReturningVisitor, 12);
  add("Enviou documento", input.sentDocument, 18);
  add("Perguntou sobre item específico", input.askedSpecificItem, 10);

  let raw = signals.reduce((sum, s) => sum + s.points, 0);
  const decay = Math.pow(0.85, input.weeksSinceLastActivity);
  raw = Math.min(100, Math.round(raw * decay));

  const band = raw >= 70 ? "hot" : raw >= 40 ? "warm" : "cold";
  return { score: raw, band, signals };
}

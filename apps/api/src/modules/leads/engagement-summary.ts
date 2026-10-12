// Real-time team summary. Engagement events (selection, budget, financing questions, escalation,
// visit scheduled, no matching inventory...) are folded into a small per-conversation state by a
// pure reducer, then rendered into a structured, team-facing summary: intent, listings ranked by
// interest, gathered preferences, budget/finance, what the visitor is waiting for, and the next
// suggested action. Deterministic on purpose — no LLM call, so it updates instantly on every event
// and can never invent facts. Dependency-free so it can be unit-tested directly.

import { describePreferences, formatCentsBRL, mergePreferences, type TriagePreferences } from "../chat/triage";

export type SummaryIntent = "rent" | "buy" | "questions";

export type EngagementEvent =
  | { type: "intent"; intent: "rent" | "buy" }
  | { type: "preferences"; preferences: TriagePreferences }
  | { type: "listing_selected"; listingId: string; title: string }
  | { type: "listing_deselected"; listingId: string }
  | { type: "listing_question"; listingIds: string[] }
  | { type: "budget"; cents: number }
  | { type: "financing_interest"; detail?: string }
  | { type: "question"; text: string; answered: boolean }
  | { type: "escalation"; topic?: string | null }
  | { type: "no_match"; preferences: TriagePreferences }
  | { type: "alert_requested"; preferences: TriagePreferences }
  | { type: "visit_scheduled"; startsAt: string; alternatives: string[]; listingId?: string | null; listingTitle?: string | null };

export interface ListingInterest {
  title: string;
  interest: number;
  selected: boolean;
  lastAt: string;
}

export interface EngagementState {
  version: 1;
  intent?: "rent" | "buy";
  preferences: TriagePreferences;
  listings: Record<string, ListingInterest>;
  budgetCents?: number;
  financingInterest: boolean;
  questionsAsked: number;
  unanswered: string[];
  escalation?: { at: string; topic?: string | null };
  visit?: { startsAt: string; alternatives: string[]; listingTitle?: string | null };
  noMatch?: { at: string; description: string };
  alertRequested?: { at: string; description: string };
  events: { at: string; label: string }[];
}

export const MAX_SUMMARY_EVENTS = 20;
const MAX_UNANSWERED = 3;

// Interest weights per listing — a selection is a strong signal, a scheduled visit the strongest.
const INTEREST = { selected: 5, question: 1, visit: 5 } as const;

export function emptyEngagementState(): EngagementState {
  return { version: 1, preferences: {}, listings: {}, financingInterest: false, questionsAsked: 0, unanswered: [], events: [] };
}

export function coerceEngagementState(raw: unknown): EngagementState {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return emptyEngagementState();
  const state = raw as EngagementState;
  return {
    ...emptyEngagementState(),
    ...state,
    preferences: state.preferences ?? {},
    listings: state.listings ?? {},
    unanswered: state.unanswered ?? [],
    events: state.events ?? [],
  };
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function eventLabel(event: EngagementEvent, state: EngagementState): string | null {
  switch (event.type) {
    case "intent":
      return event.intent === "rent" ? "Quer alugar" : "Quer comprar";
    case "preferences": {
      const described = describePreferences(event.preferences);
      return described ? `Preferências: ${described}` : null;
    }
    case "listing_selected":
      return `Selecionou: ${event.title}`;
    case "listing_deselected":
      return `Removeu da seleção: ${state.listings[event.listingId]?.title ?? "imóvel"}`;
    case "listing_question":
      return null;
    case "budget":
      return `Informou orçamento: ${formatCentsBRL(event.cents)}`;
    case "financing_interest":
      return event.detail ? `Interesse em financiamento: ${event.detail}` : "Perguntou sobre financiamento";
    case "question":
      return event.answered ? null : `Pergunta sem resposta: ${event.text.slice(0, 120)}`;
    case "escalation":
      return `Pediu atendimento humano${event.topic ? ` (${event.topic.slice(0, 80)})` : ""}`;
    case "no_match":
      return `Sem imóveis para: ${describePreferences(event.preferences) || "os filtros escolhidos"}`;
    case "alert_requested":
      return `Pediu aviso de novos imóveis: ${describePreferences(event.preferences) || "perfil informado"}`;
    case "visit_scheduled":
      return `Agendou visita para ${formatWhen(event.startsAt)}${event.alternatives.length ? ` (+${event.alternatives.length} opção alternativa)` : ""}`;
  }
}

export function applyEngagementEvent(previous: EngagementState | null | undefined, event: EngagementEvent, at: Date = new Date()): EngagementState {
  const state = coerceEngagementState(previous);
  const now = at.toISOString();
  const next: EngagementState = {
    ...state,
    preferences: { ...state.preferences },
    listings: { ...state.listings },
    unanswered: [...state.unanswered],
    events: [...state.events],
  };

  const bump = (listingId: string, title: string | undefined, delta: number, selected?: boolean) => {
    const current = next.listings[listingId];
    next.listings[listingId] = {
      title: title ?? current?.title ?? "Imóvel",
      interest: (current?.interest ?? 0) + delta,
      selected: selected ?? current?.selected ?? false,
      lastAt: now,
    };
  };

  switch (event.type) {
    case "intent":
      next.intent = event.intent;
      next.preferences.transaction = event.intent === "rent" ? "aluguel" : "venda";
      break;
    case "preferences":
      next.preferences = mergePreferences(next.preferences, event.preferences);
      if (typeof event.preferences.budgetMaxCents === "number") next.budgetCents = event.preferences.budgetMaxCents;
      if (event.preferences.transaction) next.intent = event.preferences.transaction === "venda" ? "buy" : "rent";
      break;
    case "listing_selected":
      bump(event.listingId, event.title, INTEREST.selected, true);
      break;
    case "listing_deselected":
      if (next.listings[event.listingId]) next.listings[event.listingId] = { ...next.listings[event.listingId], selected: false, lastAt: now };
      break;
    case "listing_question":
      for (const id of event.listingIds) if (next.listings[id]) bump(id, undefined, INTEREST.question);
      break;
    case "budget":
      next.budgetCents = event.cents;
      next.preferences.budgetMaxCents = event.cents;
      break;
    case "financing_interest":
      next.financingInterest = true;
      break;
    case "question":
      next.questionsAsked += 1;
      if (!event.answered) next.unanswered = [...next.unanswered, event.text.slice(0, 200)].slice(-MAX_UNANSWERED);
      break;
    case "escalation":
      next.escalation = { at: now, topic: event.topic ?? null };
      break;
    case "no_match":
      next.noMatch = { at: now, description: describePreferences(event.preferences) };
      break;
    case "alert_requested":
      next.alertRequested = { at: now, description: describePreferences(event.preferences) };
      break;
    case "visit_scheduled":
      next.visit = { startsAt: event.startsAt, alternatives: event.alternatives, listingTitle: event.listingTitle ?? null };
      if (event.listingId) bump(event.listingId, event.listingTitle ?? undefined, INTEREST.visit);
      break;
  }

  const label = eventLabel(event, state);
  if (label) {
    const last = next.events[next.events.length - 1];
    // Collapse exact repeats (e.g. the same budget restated twice in a row).
    if (!last || last.label !== label) next.events = [...next.events, { at: now, label }].slice(-MAX_SUMMARY_EVENTS);
  }
  return next;
}

export interface RankedListing {
  id: string;
  title: string;
  interest: number;
  selected: boolean;
}

export interface TeamSummary {
  intent: SummaryIntent | null;
  intentLabel: string;
  headline: string;
  rankedListings: RankedListing[];
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

const INTENT_LABELS: Record<SummaryIntent, string> = {
  rent: "Alugar",
  buy: "Comprar",
  questions: "Só dúvidas",
};

export function rankListings(state: EngagementState): RankedListing[] {
  return Object.entries(state.listings)
    .map(([id, l]) => ({ id, title: l.title, interest: l.interest, selected: l.selected, lastAt: l.lastAt }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.interest - a.interest || b.lastAt.localeCompare(a.lastAt))
    .map(({ lastAt: _lastAt, ...rest }) => rest);
}

export function resolveSummaryIntent(state: EngagementState): SummaryIntent | null {
  if (state.intent) return state.intent;
  return state.questionsAsked > 0 ? "questions" : null;
}

export function deriveWaitingFor(state: EngagementState): string | null {
  if (state.visit) return `Confirmação da visita de ${formatWhen(state.visit.startsAt)}`;
  if (state.escalation) return `Retorno do time${state.escalation.topic ? ` sobre: ${state.escalation.topic.slice(0, 100)}` : ""}`;
  if (state.alertRequested) return `Aviso quando surgir imóvel: ${state.alertRequested.description || "perfil informado"}`;
  if (state.noMatch) return `Imóvel que ainda não temos: ${state.noMatch.description || "perfil informado"}`;
  if (state.unanswered.length > 0) return `Resposta sobre: ${state.unanswered[state.unanswered.length - 1].slice(0, 100)}`;
  if (state.financingInterest) return "Informações/simulação de financiamento";
  return null;
}

export function deriveNextAction(state: EngagementState, ranked: RankedListing[]): string {
  const top = ranked.find((l) => l.selected) ?? ranked[0];
  if (state.escalation) return "Responder o cliente o quanto antes — ele pediu para falar com o time.";
  if (state.visit) return `Confirmar a visita de ${formatWhen(state.visit.startsAt)}${state.visit.listingTitle ? ` (${state.visit.listingTitle})` : ""} com o cliente.`;
  if (top && state.financingInterest) return `Enviar condições de financiamento para "${top.title}" e oferecer visita.`;
  if (top) return `Entrar em contato sobre "${top.title}" e oferecer uma visita.`;
  if (state.alertRequested || state.noMatch) return "Avisar o cliente quando entrar um imóvel com esse perfil.";
  if (state.unanswered.length > 0) return "Responder a dúvida que a IA não soube responder.";
  if (state.intent) return "Acompanhar: cliente ainda está escolhendo opções.";
  return "Acompanhar a conversa.";
}

export function renderTeamSummary(state: EngagementState, at: Date = new Date()): TeamSummary {
  const intent = resolveSummaryIntent(state);
  const rankedListings = rankListings(state);
  const preferences = describePreferences(state.preferences) || null;
  const budget = typeof state.budgetCents === "number" ? formatCentsBRL(state.budgetCents) : null;
  const financing = state.financingInterest ? "Demonstrou interesse em financiamento" : null;
  const waitingFor = deriveWaitingFor(state);
  const nextAction = deriveNextAction(state, rankedListings);
  const selectedCount = rankedListings.filter((l) => l.selected).length;
  const headlineParts = [
    intent ? INTENT_LABELS[intent] : "Intenção ainda não clara",
    selectedCount > 0 ? `${selectedCount} imóve${selectedCount === 1 ? "l" : "is"} selecionado${selectedCount === 1 ? "" : "s"}` : null,
    state.visit ? "visita agendada" : null,
    state.escalation ? "pediu atendimento humano" : null,
  ].filter(Boolean);
  return {
    intent,
    intentLabel: intent ? INTENT_LABELS[intent] : "—",
    headline: headlineParts.join(" · "),
    rankedListings,
    preferences,
    budget,
    financing,
    waitingFor,
    nextAction,
    escalated: Boolean(state.escalation),
    visit: state.visit ?? null,
    unanswered: state.unanswered,
    recentEvents: state.events.slice(-8),
    updatedAt: at.toISOString(),
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUMMARY_EVENTS,
  applyEngagementEvent,
  coerceEngagementState,
  renderTeamSummary,
  type EngagementState,
} from "../src/modules/leads/engagement-summary";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 15, minute));

function fold(events: Parameters<typeof applyEngagementEvent>[1][]): EngagementState {
  return events.reduce<EngagementState>((state, event, i) => applyEngagementEvent(state, event, at(i)), coerceEngagementState(null));
}

test("summary captures intent, preferences, ranked selections and next action", () => {
  const state = fold([
    { type: "intent", intent: "rent" },
    { type: "preferences", preferences: { bedrooms: 3, neighborhood: "Centro" } },
    { type: "listing_selected", listingId: "a", title: "Casa A" },
    { type: "listing_selected", listingId: "b", title: "Casa B" },
    { type: "listing_question", listingIds: ["b"] },
    { type: "budget", cents: 300000 },
  ]);
  const summary = renderTeamSummary(state, at(10));
  assert.equal(summary.intent, "rent");
  assert.equal(summary.intentLabel, "Alugar");
  assert.equal(summary.preferences, "aluguel, 3+ quartos, Centro, até R$ 3.000/mês");
  assert.equal(summary.budget, "R$ 3.000");
  assert.deepEqual(summary.rankedListings.map((l) => l.id), ["b", "a"]);
  assert.match(summary.nextAction, /Casa B/);
  assert.match(summary.headline, /2 imóveis selecionados/);
});

test("escalation and visit drive waitingFor and next action", () => {
  const escalated = renderTeamSummary(fold([{ type: "escalation", topic: "dúvida sobre fiador" }]));
  assert.equal(escalated.escalated, true);
  assert.match(escalated.waitingFor ?? "", /Retorno do time sobre: dúvida sobre fiador/);
  assert.match(escalated.nextAction, /falar com o time/);

  const visit = renderTeamSummary(
    fold([
      { type: "listing_selected", listingId: "a", title: "Casa A" },
      { type: "visit_scheduled", startsAt: "2026-10-14T13:00:00.000Z", alternatives: ["2026-10-15T13:00:00.000Z"], listingId: "a", listingTitle: "Casa A" },
    ]),
  );
  assert.match(visit.waitingFor ?? "", /Confirmação da visita/);
  assert.match(visit.nextAction, /Confirmar a visita/);
  assert.equal(visit.rankedListings[0].interest, 10);
});

test("no-match and alert requests record what the lead is waiting for", () => {
  const summary = renderTeamSummary(fold([{ type: "no_match", preferences: { transaction: "venda", bedrooms: 4, neighborhood: "Batel" } }]));
  assert.match(summary.waitingFor ?? "", /Imóvel que ainda não temos: compra, 4\+ quartos, Batel/);
  assert.match(summary.nextAction, /Avisar o cliente/);
});

test("questions-only visitors are labelled as such", () => {
  const summary = renderTeamSummary(fold([{ type: "question", text: "Aceita pet?", answered: true }]));
  assert.equal(summary.intent, "questions");
  const unanswered = renderTeamSummary(fold([{ type: "question", text: "Tem gerador?", answered: false }]));
  assert.deepEqual(unanswered.unanswered, ["Tem gerador?"]);
  assert.match(unanswered.waitingFor ?? "", /Tem gerador/);
});

test("deselecting keeps history but drops the selected flag", () => {
  const state = fold([
    { type: "listing_selected", listingId: "a", title: "Casa A" },
    { type: "listing_deselected", listingId: "a" },
  ]);
  assert.equal(state.listings.a.selected, false);
  assert.match(state.events[1].label, /Removeu da seleção: Casa A/);
});

test("event log is capped and repeats are collapsed", () => {
  let state = coerceEngagementState(null);
  for (let i = 0; i < MAX_SUMMARY_EVENTS + 5; i += 1) state = applyEngagementEvent(state, { type: "budget", cents: 100000 + i * 100 }, at(i));
  assert.equal(state.events.length, MAX_SUMMARY_EVENTS);
  const repeated = applyEngagementEvent(state, { type: "budget", cents: 100000 + (MAX_SUMMARY_EVENTS + 4) * 100 }, at(59));
  assert.equal(repeated.events.length, MAX_SUMMARY_EVENTS);
  assert.equal(repeated.events.at(-1)?.label, state.events.at(-1)?.label);
});

test("coerceEngagementState tolerates garbage", () => {
  assert.deepEqual(coerceEngagementState({ foo: 1 }).listings, {});
  assert.equal(coerceEngagementState("x").version, 1);
});

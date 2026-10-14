// Widget-path regressions: the consent card's chips travel as structured symptom.answer actions.

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005/client/conversation";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { createPharmacy } from "./support/pharmacy-harness";

const T = { timeout: 8000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});

test("consent card: 'Só chamar o farmacêutico' (sent with consent:true by the widget) hands off and does not start the questionnaire", T, async () => {
  net = stubNetwork(llm.text("x"));
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "estou com dor de garganta");
  const turn = await p.act(c, { type: "symptom.answer", step: "symptom", value: "Só chamar o farmacêutico", consent: true });
  assert.match(turn.text, /avisei o farmac/i);
  assert.equal(p.handoffs().length, 1);
  assert.equal(p.db.models.consentRecord.rows.some((r) => r.purposes.includes("pharmacy_triage")), false, "declining records no triage consent");
});

test("consent card: 'Concordo e quero continuar' keeps the first symptom message instead of recording the chip as the symptom", T, async () => {
  net = stubNetwork(llm.text("x"));
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "estou com dor de garganta");
  const turn = await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  assert.equal(turn.uis[0].step, "duration");
  const s = p.stateOf(c).symptom as { answers: { symptom?: string } };
  assert.equal(s.answers.symptom, "estou com dor de garganta");
});

test("consent card opened without a prior symptom text: agreeing asks what the visitor feels", T, async () => {
  net = stubNetwork(llm.text("x"));
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.act(c, { type: "handoff.request", reason: "symptom" });
  const turn = await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  assert.equal(turn.uis[0].step, "symptom");
  const s = p.stateOf(c).symptom as { answers: { symptom?: string } };
  assert.equal(s.answers.symptom, undefined);
});

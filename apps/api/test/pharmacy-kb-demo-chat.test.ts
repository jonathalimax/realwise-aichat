// Regressions found while filling the demo knowledge base and running the browser paths (deterministic, stub model, in-memory DB).

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005/client/conversation";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { createPharmacy } from "./support/pharmacy-harness";

const T = { timeout: 15000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});

const HOURS = [{ label: "Segunda a sexta", days: [1, 2, 3, 4, 5], open: "08:00", close: "22:00" }];
const SETTINGS = { openingHours: HOURS, deliveryAreas: [{ type: "district", value: "Água Verde" }], deliveryFeeCents: 600, minOrderCents: 1500, paymentMethods: ["pix", "cartao"] };
const CONDO = "Pergunta: Vocês entregam em condomínio?\nResposta: Entregamos sim! O entregador deixa o pedido na portaria.";

test("a specific delivery question is answered by the knowledge base, not by the generic hours/fees block", T, async () => {
  net = stubNetwork(llm.text("Temos sim! O entregador deixa o pedido na portaria do condomínio."));
  const p = await createPharmacy({ settings: SETTINGS });
  p.db.addChunk({ businessId: p.businessId, content: CONDO, distance: 0.1 });
  const c = await p.conversation();
  const turn = await p.say(c, "entregam em condominio? como funciona a portaria", { allowDegraded: true });
  assert.match(turn.text, /portaria/);
  assert.doesNotMatch(turn.text, /Horário de atendimento|taxa de R\$/);
  assert.equal(p.handoffs().length, 0);
});

test("generic store-information questions keep the deterministic settings answer even when the knowledge base has a chunk", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  p.db.addChunk({ businessId: p.businessId, content: CONDO, distance: 0.1 });
  const c = await p.conversation();
  assert.match((await p.say(c, "qual a taxa de entrega?")).text, /R\$ 6,00/);
  assert.match((await p.say(c, "qual o horário de funcionamento?")).text, /Horário de atendimento/);
});

test("'e se o produto estiver em falta?' is a policy question for the knowledge base, not a missing product", T, async () => {
  net = stubNetwork(llm.text("Temos sim! Se um produto estiver em falta eu aviso na hora e ofereço um equivalente."));
  const p = await createPharmacy({ settings: SETTINGS });
  p.db.addChunk({ businessId: p.businessId, content: "Pergunta: O que acontece se o produto estiver em falta?\nResposta: Avisamos na hora e oferecemos um equivalente cadastrado.", distance: 0.1 });
  const c = await p.conversation();
  const turn = await p.say(c, "e se o produto que eu quero estiver em falta?", { allowDegraded: true });
  assert.doesNotMatch(turn.text, /Não achei esse produto/);
  assert.match(turn.text, /equivalente/);
});

test("attendance: a store question typed while the product-request consent is open is answered, and the consent stays pending", T, async () => {
  net = stubNetwork(llm.text("Temos sim! Infelizmente não aceitamos vale-refeição, só Pix e cartão."));
  const p = await createPharmacy({ plan: "profissional", settings: { ...SETTINGS, operationMode: "attendance" } });
  p.db.addChunk({ businessId: p.businessId, content: "Pergunta: Vocês aceitam vale-refeição?\nResposta: Não aceitamos vale-refeição, só Pix e cartão.", distance: 0.1 });
  const c = await p.conversation();
  await p.say(c, "tem dipirona 500mg? quanto custa?");
  assert.equal(p.stateOf(c).awaiting.kind, "product_request_consent");
  const turn = await p.say(c, "vocês aceitam vale refeição?", { allowDegraded: true });
  assert.doesNotMatch(turn.text, /preciso da sua concordância/);
  assert.match(turn.text, /vale-refeição/);
  assert.equal(p.stateOf(c).awaiting.kind, "product_request_consent", "the open consent is kept for the next answer");
  const yes = await p.say(c, "Sim, pode registrar");
  assert.equal(p.handoffs().filter((h: any) => h.reason === "product_request").length, 1);
  assert.match(yes.text, /passei seu pedido/i);
});

test("the order confirmation card says whether it is a pickup (so the widget shows the pickup steps)", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  const c = await p.conversation();
  await p.say(c, "quero 1 dipirona");
  await p.toReview(c, { name: "Marina Alves", fulfillment: "retirada" });
  const done = await p.act(c, { type: "checkout.confirm" });
  assert.equal(done.uis[0].type, "order_confirmation");
  assert.equal(done.uis[0].fulfillment, "pickup");
  // a double tap repeats the same card with the same fulfillment
  const again = await p.act(c, { type: "checkout.confirm" });
  assert.equal(again.uis[0].fulfillment, "pickup");
});

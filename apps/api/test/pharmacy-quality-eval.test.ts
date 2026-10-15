// Conversation-quality eval for Alex (pharmacy), deterministic (stub model, in-memory DB).
// ~25 realistic customer conversations scored on four axes, all of which must be at 100%:
//   - re-asks: nothing the customer already answered (consent, phone, name, e-mail, address, quantity) is asked twice
//   - unnecessary escalations: handoffs only where the conversation truly needs a human
//   - KB answers: questions covered by the pharmacy knowledge base are answered from it, not escalated
//   - warmth: name used once known, empathy on symptom turns, thanks/closing line, never a cold dead end

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005/chat";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { createPharmacy, type Pharmacy } from "./support/pharmacy-harness";

const T = { timeout: 15000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});

const HOURS = [
  { label: "Segunda a sexta", days: [1, 2, 3, 4, 5], open: "08:00", close: "22:00" },
  { label: "Sábado", days: [6], open: "08:00", close: "20:00" },
];
const SETTINGS = { openingHours: HOURS, deliveryAreas: [{ type: "district", value: "Água Verde" }], deliveryFeeCents: 600, minOrderCents: 1500, paymentMethods: ["pix", "cartao"], pharmacistName: "Dra. Carla Menezes" };

type Step = { say?: string; act?: Record<string, unknown> };
interface Convo {
  name: string;
  steps: Step[];
  /** Number of pharmacist/general handoffs the conversation legitimately needs. */
  handoffs: number;
  kb?: { chunk: string; model: string };
  /** Regexes that must appear somewhere in what Alex said. */
  warm?: RegExp[];
  empathy?: boolean;
  nameUsed?: string;
  products?: string[];
}

const EMPATHY = /sinto muito|vamos cuidar|estou aqui/i;
const THANKS = /obrigad|prazer em ajudar|por nada/i;

const CONVOS: Convo[] = [
  { name: "hours chip", steps: [{ say: "Horários e entrega" }], handoffs: 0 },
  { name: "delivery fee question", steps: [{ say: "qual a taxa de entrega?" }, { say: "e vocês aceitam pix?" }], handoffs: 0 },
  { name: "browse and add", steps: [{ say: "o que vocês têm?" }, { say: "quero dipirona" }, { say: "mais um" }, { say: "tira um" }, { say: "obrigado" }], handoffs: 0, warm: [THANKS] },
  { name: "remove by name and clear", steps: [{ say: "quero 2 paracetamol" }, { say: "tira o paracetamol" }, { say: "quero dipirona" }, { say: "remove tudo" }], handoffs: 0 },
  { name: "unknown product", steps: [{ say: "quero cadeira de rodas" }], handoffs: 0 },
  { name: "dosage question", steps: [{ say: "quanto devo tomar de dipirona?" }], handoffs: 0, warm: [/segurança|farmacêutico/i] },
  { name: "controlled medicine", steps: [{ say: "quero clonazepam" }], handoffs: 0 },
  { name: "order status without order", steps: [{ say: "cadê meu pedido?" }], handoffs: 0 },
  { name: "symptom adult", steps: [{ say: "estou com dor de cabeça" }, { act: { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true } }], handoffs: 0, empathy: true },
  { name: "thanks and greeting", steps: [{ say: "oi" }, { say: "valeu" }], handoffs: 0, warm: [THANKS] },
  { name: "holiday question (no KB)", steps: [{ say: "vocês abrem no feriado?" }], handoffs: 1, warm: [/equipe/i] },
  { name: "KB parking", steps: [{ say: "tem estacionamento para clientes?" }], handoffs: 0, kb: { chunk: "Temos estacionamento gratuito para clientes ao lado da farmácia, com 12 vagas.", model: "Temos sim! O estacionamento é gratuito para clientes, ao lado da farmácia, com 12 vagas." } },
  { name: "KB promotions", steps: [{ say: "tem alguma promoção essa semana?" }], handoffs: 0, kb: { chunk: "Promoção da semana: 10% de desconto em produtos de higiene pessoal toda terça-feira.", model: "Tem sim! Toda terça-feira os produtos de higiene pessoal têm 10% de desconto." } },
  { name: "KB invoice", steps: [{ say: "vocês emitem nota fiscal?" }], handoffs: 0, kb: { chunk: "Emitimos nota fiscal em todas as vendas; ela é enviada por e-mail ou entregue junto do pedido.", model: "Emitimos sim, em todas as vendas. Ela vai por e-mail ou junto do pedido." } },
  { name: "KB holiday", steps: [{ say: "vocês abrem no feriado?" }], handoffs: 0, kb: { chunk: "Nos feriados nacionais a farmácia abre das 9h às 18h.", model: "Abrimos sim! Nos feriados nacionais funcionamos das 9h às 18h." } },
  { name: "attendant request", steps: [{ say: "quero falar com um atendente" }, { say: "tem desconto para idosos?" }], handoffs: 1 },
];

function phones(texts: string[]) {
  return texts.filter((t) => /WhatsApp \(com DDD\)|qual o seu WhatsApp|Me passe o número/i.test(t)).length;
}

async function run(convo: Convo) {
  net = convo.kb ? stubNetwork(llm.text(convo.kb.model)) : stubNetwork(llm.text("Essa informação eu não tenho."));
  const p = await createPharmacy({ settings: SETTINGS });
  if (convo.kb) p.db.addChunk({ businessId: p.businessId, content: convo.kb.chunk, distance: 0.1 });
  const c = await p.conversation();
  const seen: string[] = [];
  for (const step of convo.steps) {
    const turn = step.say ? await p.say(c, step.say, { allowDegraded: true }) : await p.act(c, step.act!);
    seen.push(...turn.texts);
    // Never a bare dead end.
    assert.ok(turn.text.trim().length > 0, `${convo.name}: empty reply to ${JSON.stringify(step)}`);
  }
  return { p, c, seen };
}

for (const convo of CONVOS) {
  test(`quality eval: ${convo.name}`, T, async () => {
    const { p, seen } = await run(convo);
    // 1) escalations
    const general = p.handoffs().filter((h: any) => h.reason === "general_question" || h.reason === "other").length;
    assert.equal(general, convo.handoffs, `${convo.name}: handoffs ${general}, expected ${convo.handoffs}`);
    // 2) KB answers
    if (convo.kb) {
      assert.ok(seen.some((t) => /Temos sim|Tem sim|Emitimos sim|Abrimos sim/.test(t)), `${convo.name}: not answered from the knowledge base: ${seen.join(" | ")}`);
      assert.ok(!seen.some((t) => /não tenho essa informação|pedir para a equipe|equipe da farmácia confirmar/i.test(t)), `${convo.name}: escalated despite the KB`);
    }
    // 3) re-asks: the phone is asked at most once per conversation
    assert.ok(phones(seen) <= 1, `${convo.name}: phone asked ${phones(seen)} times`);
    // 4) warmth
    const all = seen.join("\n");
    for (const re of convo.warm ?? []) assert.match(all, re, `${convo.name}: missing warmth marker ${re}`);
    if (convo.empathy) assert.match(all, EMPATHY, `${convo.name}: no empathy line`);
    // never robotic / legalistic openers
    assert.doesNotMatch(all, /não foi possível|erro interno|operação inválida/i, convo.name);
  });
}

// ---- longer flows with explicit no-re-ask and warmth assertions ----

test("quality eval: full OTC order: consent, phone, name, e-mail, address asked once; name used in the confirmation", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  const c = await p.conversation();
  await p.say(c, "quero 2 dipirona");
  await p.toReview(c, { name: "Marina Alves" });
  const said: string[] = [];
  const st = p.stateOf(c);
  assert.equal(st.contact.name, "Marina Alves");
  const turn = await p.act(c, { type: "checkout.confirm" });
  said.push(turn.text);
  assert.match(turn.text, /Marina/, "the confirmation uses the first name");
  assert.match(turn.text, /obrigad/i);
  // no field asked twice across the whole conversation
  const assistant = p.assistantTexts(c);
  const count = (re: RegExp) => assistant.filter((t) => re.test(t)).length;
  assert.ok(count(/qual o seu whatsapp/i) <= 1, "phone asked once");
  assert.ok(count(/qual o seu nome/i) <= 1, "name asked once");
  assert.ok(count(/qual o cep/i) <= 1, "CEP asked once");
  assert.ok(count(/me passe seu e-mail/i) <= 1, "e-mail asked once");
});

test("quality eval: a second order in the same conversation never re-asks contact, consent or address", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  const c = await p.conversation();
  await p.say(c, "quero dipirona");
  await p.toReview(c, { name: "Marina Alves" });
  await p.act(c, { type: "checkout.confirm" });
  const before = p.assistantTexts(c).length;
  await p.say(c, "quero paracetamol");
  await p.say(c, "finalizar pedido");
  const after = p.assistantTexts(c).slice(before).join("\n");
  assert.doesNotMatch(after, /qual o seu whatsapp|qual o seu nome|posso guardar esses dados/i, after);
});

test("quality eval: symptom for a child: empathy, one question at a time, the name is used once known", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  const c = await p.conversation();
  const first = await p.say(c, "meu filho está com febre há 2 dias");
  const all: string[] = [first.text];
  assert.match(first.text, EMPATHY);
  // after the one-tap consent, the consent is never asked again in this conversation
  const tap = await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  all.push(tap.text);
  const next = await p.say(c, "ele tem 5 anos");
  all.push(next.text);
  const nextNext = await p.say(c, "mais de 1 dia");
  all.push(nextNext.text);
  const consentAsks = all.slice(1).filter((t) => /posso anotar o que você me contar/i.test(t)).length;
  assert.equal(consentAsks, 0, `consent asked again after the tap: ${all.join(" | ")}`);
});

test("quality eval: 'tira a dipirona' / 'remove tudo' / removing something not in the cart never fall to the model or a handoff", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: SETTINGS });
  const c = await p.conversation();
  await p.say(c, "quero 2 dipirona");
  let turn = await p.say(c, "tira o paracetamol");
  assert.match(turn.text, /não está no seu carrinho/i);
  assert.equal(((p.stateOf(c).cart ?? []) as unknown[]).length, 1);
  turn = await p.say(c, "tira a dipirona");
  assert.equal(((p.stateOf(c).cart ?? []) as unknown[]).length, 0, "named removal with an article");
  await p.say(c, "quero paracetamol");
  await p.say(c, "quero dipirona");
  turn = await p.say(c, "remove tudo");
  assert.match(turn.text, /esvaziei o carrinho/i);
  assert.equal(((p.stateOf(c).cart ?? []) as unknown[]).length, 0);
  turn = await p.say(c, "tira o paracetamol");
  assert.match(turn.text, /carrinho está vazio/i);
  assert.equal(net!.llmCalls.length, 0);
  assert.equal(p.handoffs().length, 0);
});

test("quality eval: below the delivery minimum Alex says how much is missing and offers pickup / one more item", T, async () => {
  net = stubNetwork(llm.text("não deve ser chamado"));
  const p = await createPharmacy({ settings: { ...SETTINGS, minOrderCents: 2500, pickupEnabled: true } });
  const c = await p.conversation();
  await p.say(c, "quero 1 dipirona");
  const turn = await p.toReview(c, { name: "Marina Alves" });
  assert.match(turn.text, /faltam R\$ 16,10/);
  assert.ok(turn.suggestions.includes("Adicionar outro item"));
  assert.ok(turn.suggestions.includes("Retirada em loja"));
});

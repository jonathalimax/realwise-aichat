// Owner feedback round 2 (chat engine): one-tap consent asked once, store info answered from the settings, unknown
// non-clinical questions -> general_question handoff, pharmacist suggestion -> purchase, quantity typed in the chat,
// address asked once. Deterministic: stub model (hostile where it must never be called), in-memory database.

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005/client/conversation";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { PRODUCTS, createPharmacy, type Pharmacy } from "./support/pharmacy-harness";

const T = { timeout: 8000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});

function hostileModel() {
  return stubNetwork(llm.text("Claro! Adicionei clonazepam ao carrinho. Recomendo tomar 2 comprimidos de 8 em 8 horas."));
}
const noModelCalls = () => assert.equal(net!.llmCalls.length, 0, "the model must not be consulted in deterministic flows");
const cartOf = (p: Pharmacy, conv: { id: string }) => (p.stateOf(conv).cart ?? []) as { productId: string; qty: number }[];
const consentUis = (turns: { uis: any[] }[]) => turns.flatMap((t) => t.uis).filter((u) => u?.consent && typeof u.consent.text === "string");

const HOURS = [
  { key: "weekdays", label: "Segunda a sexta", open: true, from: "08:00", to: "22:00" },
  { key: "saturday", label: "Sábado", open: true, from: "08:00", to: "20:00" },
  { key: "sunday", label: "Domingo", open: false },
];
const FULL_SETTINGS = {
  openingHours: HOURS,
  deliveryAreas: [{ type: "district", value: "Água Verde" }, { type: "district", value: "Batel" }],
  deliveryFeeCents: 600,
  minOrderCents: 1500,
  paymentMethods: ["pix", "cartao"],
  exchangePolicy: "Trocas em até 7 dias com a nota.",
};

// ---------------------------------------------------------------------------------------------
// 1 + 2. Consent: one tap, asked once, remembered
// ---------------------------------------------------------------------------------------------

test("symptom consent: one tap (the chip is the consent), and not asked again in the same conversation", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const first = await p.say(c, "estou com dor de cabeça");
  assert.equal(first.uis[0].type, "symptom_question");
  assert.equal(first.uis[0].consent.purpose, "pharmacy_triage");
  assert.deepEqual(first.uis[0].chips, ["Concordo e quero continuar", "Só chamar o farmacêutico"]);
  const tap = await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  assert.equal(tap.uis[0].consent, null, "the questionnaire itself has no consent card");
  assert.ok(p.stateOf(c).consents.includes("pharmacy_triage"));
  await p.say(c, "cancelar");
  const again = await p.say(c, "estou com tosse");
  assert.ok(consentUis([again]).length === 0, "no second consent card for the same purpose");
  assert.equal(again.uis[0].type, "symptom_question");
  assert.equal(p.db.models.consentRecord.rows.filter((r) => r.purposes.includes("pharmacy_triage")).length, 1);
  noModelCalls();
});

test("consent remembered per lead: a recognized visitor in a NEW conversation is not asked again", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const lead = await p.db.models.lead.create({ data: { businessId: p.businessId, name: "Ana Paula", phone: "5541998123344", phoneNormalized: "5541998123344" } });
  await p.db.models.consentRecord.create({ data: { businessId: p.businessId, leadId: lead.id, phoneHash: "x", consentTextVersion: "2026-10", purposes: ["pharmacy_triage", "contact"] } });
  const c = await p.conversation();
  p.db.models.conversation.rows.find((r) => r.id === c.id)!.leadId = lead.id;
  const turn = await p.say(c, "estou com dor de garganta");
  assert.equal(turn.uis[0].type, "symptom_question");
  assert.equal(turn.uis[0].consent, null);
  assert.equal(p.stateOf(c).awaiting.kind, "symptom_answer");
  noModelCalls();
});

test("REGRESSION consent loop: new visitor add item -> finalizar -> phone/name -> consent -> Entrega -> CEP form, zero repeated consent cards", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const turns = [] as Awaited<ReturnType<typeof p.act>>[];
  turns.push(await p.act(c, { type: "cart.add", productId: "p_dipirona", qty: 1 }));
  turns.push(await p.act(c, { type: "checkout.start" }));
  turns.push((await p.say(c, "(41) 99812-3344")) as any);
  // The card for the missing name/e-mail does not repeat the notice; the form posts name + consent in one tap.
  const nameCard = turns.at(-1)!.uis[0];
  assert.deepEqual(nameCard.fields, ["name", "email"]);
  assert.equal(nameCard.consent, null);
  turns.push(await p.act(c, { type: "checkout.contact", name: "João Silva", consent: true }));
  assert.equal(p.stateOf(c).awaiting.kind, "fulfillment", turns.at(-1)!.text);
  turns.push(await p.act(c, { type: "checkout.fulfillment", fulfillment: "delivery" }));
  assert.equal(turns.at(-1)!.uis[0].type, "address_capture");
  assert.equal(p.stateOf(c).awaiting.kind, "cep");
  assert.equal(consentUis(turns).length, 1, "the notice appears once (the phone form), never again");
  noModelCalls();
});

test("widget path with an empty optional e-mail: submitting only the consent moves on (no card loop)", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero dipirona 500mg");
  await p.say(c, "finalizar pedido");
  await p.say(c, "(41) 99812-3344");
  await p.say(c, "João Silva");
  assert.equal(p.stateOf(c).awaiting.kind, "email");
  await p.act(c, { type: "checkout.contact", consent: true });
  assert.equal(p.stateOf(c).awaiting.kind, "fulfillment");
  assert.equal(p.db.models.lead.rows.length, 1);
  noModelCalls();
});

test("typed path: the consent step appears once; declining explains the options and never switches to pickup", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero dipirona 500mg");
  await p.say(c, "finalizar pedido");
  await p.say(c, "(41) 99812-3344");
  await p.say(c, "João Silva");
  const ask = await p.say(c, "Prefiro não informar");
  assert.equal(p.stateOf(c).awaiting.kind, "contact_consent");
  assert.equal(ask.uis[0].consent.purpose, "order_contact");
  assert.ok(ask.suggestions.includes("Concordo e quero continuar"));
  const declined = await p.say(c, "não concordo");
  assert.match(declined.text, /entrega ou a retirada/);
  assert.equal(p.stateOf(c).awaiting.kind, "contact_consent", "the question stays open");
  assert.equal(p.stateOf(c).fulfillment, undefined, "no silent switch to pickup");
  assert.ok(declined.suggestions.includes("Concordo e quero continuar"));
  const ok = await p.say(c, "Concordo e quero continuar");
  assert.equal(p.stateOf(c).awaiting.kind, "fulfillment");
  assert.equal(consentUis([ok]).length, 0);
  noModelCalls();
});

// ---------------------------------------------------------------------------------------------
// 3. Store information from PharmacySettings (lane F)
// ---------------------------------------------------------------------------------------------

test("info chips answer from the settings: hours per weekday, delivery fee/areas/minimum, pickup, payment, chips", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ settings: FULL_SETTINGS });
  for (const chip of ["Horários e entrega", "Horário de funcionamento", "Taxa de entrega", "Quero ver todas as informações", "todas as informações"]) {
    const turn = await p.say(await p.conversation(), chip);
    assert.ok(!/o que você quer saber/i.test(turn.text), chip);
    assert.deepEqual(turn.suggestions, ["Fazer um pedido", "Falar com atendente"], chip);
    if (/hor[áa]rio/i.test(chip) || /informa/i.test(chip)) {
      assert.match(turn.text, /Segunda a sexta: 08:00 às 22:00/, chip);
      assert.match(turn.text, /Sábado: 08:00 às 20:00/, chip);
      assert.match(turn.text, /Domingo: fechado/, chip);
    }
    if (/entrega|informa/i.test(chip)) {
      assert.match(turn.text, /taxa de R\$ 6,00/, chip);
      assert.match(turn.text, /Pedido mínimo para entrega: R\$ 15,00/, chip);
      assert.match(turn.text, /Água Verde, Batel/, chip);
    }
    if (/Horários e entrega|informa/i.test(chip)) {
      assert.match(turn.text, /retirar o pedido na loja/, chip);
      assert.match(turn.text, /Pix\/cartão/, chip);
    }
    if (/informa/i.test(chip)) assert.match(turn.text, /Trocas em até 7 dias/, chip);
  }
  // Natural phrasings land in the same lane.
  for (const text of ["que horas vocês abrem?", "qual a taxa de entrega?", "vocês aceitam pix?", "tem retirada na loja?"]) {
    const turn = await p.say(await p.conversation(), text);
    assert.ok(turn.text.includes("**") || /Pix|retirar|taxa/.test(turn.text), text);
    assert.equal(p.handoffs().length, 0, text);
  }
  noModelCalls();
});

test("an info chip typed in the middle of the questionnaire answers and then repeats the open question", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ settings: FULL_SETTINGS });
  const c = await p.conversation();
  await p.say(c, "estou com dor de cabeça");
  await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  const turn = await p.say(c, "Horário de funcionamento");
  assert.match(turn.texts[0], /Segunda a sexta/);
  assert.equal(turn.uis.at(-1)!.type, "symptom_question");
  assert.equal(p.stateOf(c).awaiting.kind, "symptom_answer");
  noModelCalls();
});

// ---------------------------------------------------------------------------------------------
// 4. Unknown non-clinical question -> general_question handoff (attendant), notified, zero model calls
// ---------------------------------------------------------------------------------------------

test("unknown store question (holiday opening): says so, creates a general_question handoff, notifies without the question text, never calls the model", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ settings: FULL_SETTINGS });
  const c = await p.conversation();
  const turn = await p.say(c, "Vocês abrem no feriado de 15 de novembro?");
  assert.match(turn.texts[0], /^Não tenho essa informação agora\. Vou pedir para a equipe da farmácia confirmar e te respondo aqui mesmo\.$/);
  const handoff = p.handoffs().find((h) => h.reason === "general_question")!;
  assert.ok(handoff, "general_question handoff created");
  assert.equal(handoff.summary, "Vocês abrem no feriado de 15 de novembro?");
  assert.equal(handoff.urgent, false);
  const alert = p.spies.alerts.calls.createAlert.map(([, a]: any) => a).find((a: any) => a.type === "pharmacy_new_handoff");
  assert.equal(alert.message, "Nova pergunta de cliente aguardando resposta");
  assert.ok(!/feriado/i.test(alert.message), "the alert never carries the question");
  // Phone is asked once (not known yet) with the contact consent card.
  assert.equal(p.stateOf(c).awaiting.kind, "question_phone");
  assert.equal(turn.uis.at(-1)!.consent.purpose, "pharmacy_contact");
  const done = await p.act(c, { type: "checkout.contact", phone: "(41) 99812-3344", name: "Marina Alves", consent: true });
  assert.match(done.text, /Anotei seu contato/);
  const linked = p.handoffs().find((h) => h.reason === "general_question")!;
  assert.ok(linked.leadId, "the lead is attached to the handoff");
  assert.equal(p.stateOf(c).awaiting, null);
  // A second unknown question: no phone, no consent card again.
  const second = await p.say(c, "Tem estacionamento para clientes?");
  assert.equal(p.handoffs().filter((h) => h.reason === "general_question").length, 2);
  assert.equal(consentUis([second]).length, 0);
  assert.equal(p.stateOf(c).awaiting, null);
  noModelCalls();
});

test("unknown question answered 'I don't know' by the model also becomes a general_question handoff; clinical ones do not", T, async () => {
  net = stubNetwork(llm.text("Não tenho essa informação sobre isso."));
  const p = await createPharmacy();
  const c = await p.conversation();
  const turn = await p.say(c, "Vocês têm balança para pesar as compras na loja?");
  assert.match(turn.text, /equipe da farmácia confirmar/);
  assert.equal(p.handoffs().filter((h) => h.reason === "general_question").length, 1);
  // A clinical sentence is never a general question: it goes to the pharmacist lane.
  const clinical = await p.say(await p.conversation(), "estou com febre e dor de cabeça, o que posso tomar?");
  assert.ok(!p.handoffs().some((h) => h.reason === "general_question" && /febre/.test(h.summary)));
  assert.equal(clinical.uis[0].type, "symptom_question");
});

test("'Falar com atendente' asks the question, then hands it to the team (not the pharmacist)", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const ask = await p.say(c, "Falar com atendente");
  assert.equal(p.stateOf(c).awaiting.kind, "attendant_question");
  assert.match(ask.text, /Qual é a sua dúvida/);
  await p.say(c, "Preciso da segunda via do comprovante da compra de ontem");
  const h = p.handoffs().find((x) => x.reason === "general_question")!;
  assert.match(h.summary, /segunda via/);
  assert.ok(!p.handoffs().some((x) => x.reason === "symptom"));
  noModelCalls();
});

// ---------------------------------------------------------------------------------------------
// 6. Pharmacist suggestion -> purchase
// ---------------------------------------------------------------------------------------------

async function suggestionFor(p: Pharmacy, c: { id: string }, keys: string[], extra: Record<string, unknown> = {}) {
  const ids = keys.map((k) => PRODUCTS[k as keyof typeof PRODUCTS].id);
  const row = await p.db.models.message.create({
    data: {
      conversationId: c.id,
      businessId: p.businessId,
      role: "owner",
      content: "Indico estes itens para você.",
      createdAt: new Date(),
      authorMemberId: "m1",
      authorName: "Dra. Carla Menezes",
      authorRole: "Farmacêutica",
      uiData: {
        type: "pharmacist_suggestion",
        from: { name: "Dra. Carla Menezes", roleName: "Farmacêutica" },
        note: "Tomar com água.",
        items: ids.map((id) => ({ productId: id, name: id, presentation: "x", priceCents: 1, inStock: true, maxQty: 5, imageUrl: null, placeholderIcon: "pill", requiresPrescription: false })),
        ...extra,
      },
    },
  });
  return row;
}

test("'quero comprar' after a pharmacist suggestion adds THOSE items, never the generic catalog list", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await suggestionFor(p, c, ["paracetamol", "loratadina"]);
  const turn = await p.say(c, "quero comprar");
  assert.equal(turn.texts[0], "Vou separar o que o farmacêutico indicou:");
  assert.ok(!turn.uis.some((u) => u.type === "catalog_list"));
  assert.deepEqual(cartOf(p, c).map((l) => l.productId).sort(), ["p_lorat", "p_paracetamol"]);
  assert.equal(turn.uis[0].type, "cart");
  // Handled: "Fazer um pedido" is the generic catalog again, and "ver outros produtos" always is.
  const other = await p.say(c, "ver outros produtos");
  assert.equal(other.uis[0].type, "catalog_list");
  noModelCalls();
});

test("suggestion phrases: quero esses / vou levar / pode ser / o primeiro; the catalog list only without a suggestion", T, async () => {
  net = hostileModel();
  for (const [phrase, expected] of [["quero esses", 2], ["vou levar", 2], ["pode ser", 2], ["quero o primeiro", 1], ["quero isso", 2]] as const) {
    const p = await createPharmacy();
    const c = await p.conversation();
    await suggestionFor(p, c, ["paracetamol", "loratadina"]);
    const turn = await p.say(c, phrase);
    assert.equal(cartOf(p, c).length, expected, phrase);
    assert.ok(!turn.uis.some((u) => u.type === "catalog_list"), phrase);
  }
  // No suggestion: "Fazer um pedido" shows the catalog as before.
  const p = await createPharmacy();
  const turn = await p.say(await p.conversation(), "Fazer um pedido");
  assert.equal(turn.uis[0].type, "catalog_list");
  noModelCalls();
});

test("suggestion with out-of-stock and controlled items: only the sellable one enters the cart, the others are explained", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await suggestionFor(p, c, ["paracetamol", "soro", "clonazepam", "xarope"]);
  const turn = await p.say(c, "quero comprar");
  assert.deepEqual(cartOf(p, c).map((l) => l.productId), ["p_paracetamol"]);
  const blocked = turn.texts.find((t) => /Não consegui adicionar/.test(t))!;
  assert.match(blocked, /Soro fisiológico.*sem estoque/);
  assert.match(blocked, /Clonazepam.*não é vendido online/);
  assert.match(blocked, /Xarope Alfa.*não é vendido online/);
  noModelCalls();
});

test("cart.add_many validates class/stock/limit from the DB exactly like cart.add (controlled never enters, the client decides nothing)", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const res = await p.act(c, { type: "cart.add_many", productIds: ["p_dipirona", "p_clonazepam", "p_soro", "p_xarope", "p_vitc"] });
  assert.deepEqual(cartOf(p, c).map((l) => l.productId), ["p_dipirona"]);
  assert.match(res.text, /Não consegui adicionar/);
  // Per-order limit: Loratadina max 3 (qty above is refused, not clamped).
  const over = await p.act(c, { type: "cart.add_many", items: [{ productId: "p_lorat", qty: 9 }] });
  assert.ok(!cartOf(p, c).some((l) => l.productId === "p_lorat"));
  assert.match(over.text, /acima do máximo/);
  // Prescription item: waits for the photo (never in the cart without an upload).
  const rx = await p.act(c, { type: "cart.add_many", productIds: ["p_amoxicilina"] });
  assert.ok(!cartOf(p, c).some((l) => l.productId === "p_amoxicilina"));
  assert.equal(p.stateOf(c).pendingRx.length, 1);
  assert.ok(rx.uis.some((u) => u.type === "rx_upload"));
  noModelCalls();
});

test("history refreshes the live price and stock of a stored suggestion card", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const row = await suggestionFor(p, c, ["paracetamol", "soro"]);
  p.db.models.product.rows.find((r) => r.id === "p_paracetamol")!.priceCents = 1999;
  const [hydrated] = await p.pharmacy.hydrateMessages(p.businessId, [row]);
  const items = hydrated.uiData.items;
  assert.equal(items[0].priceCents, 1999);
  assert.equal(items[0].sellable, true);
  assert.equal(items[1].inStock, false);
  assert.equal(items[1].sellable, false);
  assert.equal(items[1].unavailableReason, "out_of_stock");
  assert.equal(hydrated.uiData.from.name, "Dra. Carla Menezes");
});

// ---------------------------------------------------------------------------------------------
// Quantity typed in the chat
// ---------------------------------------------------------------------------------------------

test("quantity by text: increase, decrease, set absolute, remove; the answer is the updated cart card with maxQty", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero dipirona 500mg");
  assert.equal(cartOf(p, c)[0].qty, 1);
  const more = await p.say(c, "mais um");
  assert.equal(cartOf(p, c)[0].qty, 2);
  assert.equal(more.uis[0].type, "cart");
  assert.equal(more.uis[0].cart.items[0].maxQty, 5);
  await p.say(c, "mais dois");
  assert.equal(cartOf(p, c)[0].qty, 4);
  await p.say(c, "tira um");
  assert.equal(cartOf(p, c)[0].qty, 3);
  await p.say(c, "só 1");
  assert.equal(cartOf(p, c)[0].qty, 1);
  await p.say(c, "coloca 2");
  assert.equal(cartOf(p, c)[0].qty, 2);
  await p.say(c, "mude para 3");
  assert.equal(cartOf(p, c)[0].qty, 3);
  await p.say(c, "na verdade são 4");
  assert.equal(cartOf(p, c)[0].qty, 4);
  const removed = await p.say(c, "tira esse");
  assert.deepEqual(cartOf(p, c), []);
  assert.match(removed.text, /Tirei/);
  noModelCalls();
});

test("quantity by text targets the focused / last added line and 'quero 2 da dipirona' sets a line already in the cart", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero dipirona 500mg");
  await p.say(c, "quero paracetamol 750");
  await p.say(c, "mais um"); // last added: paracetamol
  assert.equal(cartOf(p, c).find((l) => l.productId === "p_paracetamol")!.qty, 2);
  assert.equal(cartOf(p, c).find((l) => l.productId === "p_dipirona")!.qty, 1);
  await p.say(c, "quero 3 da dipirona");
  assert.equal(cartOf(p, c).find((l) => l.productId === "p_dipirona")!.qty, 3);
  await p.say(c, "remove"); // last edited line (dipirona)
  assert.ok(!cartOf(p, c).some((l) => l.productId === "p_dipirona"));
  noModelCalls();
});

test("quantity by text respects the per-order limit and the stock, with clear messages", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero 3 loratadina"); // max 3
  const over = await p.say(c, "mais um");
  assert.equal(cartOf(p, c)[0].qty, 3);
  assert.match(over.text, /máximo por pedido de Loratadina.* é 3/);
  p.db.models.product.rows.find((r) => r.id === "p_ibuprofeno")!.stockQty = 2;
  await p.say(c, "quero ibuprofeno 600");
  const short = await p.say(c, "mais dois");
  assert.equal(cartOf(p, c).find((l) => l.productId === "p_ibuprofeno")!.qty, 1);
  assert.match(short.text, /apenas 2 unidades de Ibuprofeno/);
  noModelCalls();
});

// ---------------------------------------------------------------------------------------------
// 7. Address asked once
// ---------------------------------------------------------------------------------------------

test("delivery asks the CEP once and reuses the confirmed address; pickup never asks; never twice in a conversation", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "quero dipirona 500mg");
  const review = await p.toReview(c);
  assert.equal(review.uis[0].type, "order_review");
  const cepAsks = () => p.assistantTexts(c).filter((t) => /Qual o CEP/.test(t)).length;
  assert.equal(cepAsks(), 1);
  // Back to the cart and check out again BEFORE confirming: the confirmed address is reused.
  await p.say(c, "Alterar itens");
  await p.say(c, "quero paracetamol 750");
  await p.say(c, "finalizar pedido");
  const again = await p.say(c, "entrega");
  assert.equal(again.uis.at(-1)!.type, "order_review");
  assert.match(again.text, /Usei o endereço que você já confirmou/);
  assert.ok(again.suggestions.includes("Informar outro endereço"));
  assert.equal(cepAsks(), 1, "the CEP was not asked a second time");
  await p.say(c, "Confirmar pedido");
  assert.equal(p.orders().length, 1);
  // A second order in the same conversation: delivery reuses it, pickup skips the address.
  await p.say(c, "quero loratadina");
  await p.say(c, "finalizar pedido");
  const second = await p.say(c, "entrega");
  assert.equal(second.uis.at(-1)!.type, "order_review");
  assert.equal(cepAsks(), 1);
  await p.say(c, "Informar outro endereço");
  assert.equal(p.stateOf(c).awaiting.kind, "cep", "the visitor can still change it explicitly");
  const pickupConv = await p.conversation();
  await p.say(pickupConv, "quero dipirona 500mg");
  const pickup = await p.toReview(pickupConv, { fulfillment: "retirada" });
  assert.equal(pickup.uis.at(-1)!.fulfillment, "pickup");
  assert.ok(!p.assistantTexts(pickupConv).some((t) => /CEP/.test(t)));
  noModelCalls();
});

// ---------------------------------------------------------------------------------------------
// Symptom questionnaire: the age question depends on who the patient is
// ---------------------------------------------------------------------------------------------

async function toForWhom(p: Pharmacy, c: { id: string; visitorToken: string }) {
  await p.say(c, "estou com dor de garganta");
  await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  await p.say(c, "Hoje");
  await p.say(c, "Leve");
  assert.equal(p.stateOf(c).awaiting.step, "for_whom");
}
const lastChips = (turn: { uis: any[] }) => turn.uis.at(-1)!.chips as string[];

test("age question: adult chips for 'Para mim' (no child ranges)", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await toForWhom(p, c);
  const age = await p.say(c, "Para mim");
  assert.deepEqual(lastChips(age), ["18 a 29 anos", "30 a 59 anos", "60 anos ou mais"]);
  const other = await createPharmacy();
  const c2 = await other.conversation();
  await toForWhom(other, c2);
  assert.deepEqual(lastChips(await other.say(c2, "Para outra pessoa adulta")), ["18 a 29 anos", "30 a 59 anos", "60 anos ou mais"]);
  noModelCalls();
});

test("age question for a child: only child ranges, an adult age is asked again, the brief is flagged pediatric", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await toForWhom(p, c);
  const age = await p.say(c, "Para uma criança");
  assert.deepEqual(lastChips(age), ["Menos de 2 anos", "2 a 5 anos", "6 a 11 anos", "12 a 17 anos"]);
  assert.ok(!lastChips(age).some((x) => /18|60/.test(x)));
  const wrong = await p.say(c, "35");
  assert.match(wrong.text, /não combina com uma criança/);
  assert.equal(p.stateOf(c).awaiting.step, "age", "the age is asked again");
  assert.equal(p.stateOf(c).symptom.answers.age, undefined);
  const wrongChip = await p.say(c, "30 anos");
  assert.match(wrongChip.text, /não combina/);
  await p.say(c, "6 a 11 anos");
  assert.notEqual(p.stateOf(c).awaiting.step, "age");
  // Finish the questionnaire (no phone: keep the web chat only) and read the brief.
  for (const answer of ["Não tenho", "Não uso outros", "Nada ainda"]) await p.say(c, answer);
  await p.say(c, "Prefiro continuar só pelo chat");
  const handoff = p.handoffs().find((h) => h.reason === "symptom")!;
  assert.equal(handoff.brief.forWhom.patient, "child");
  assert.equal(handoff.brief.forWhom.age, "6 a 11 anos");
  assert.equal(handoff.brief.forWhom.pediatric, true);
  assert.match(handoff.brief.forWhom.attention, /pediátrico/);
  noModelCalls();
});

test("age question for a baby: baby ranges, an age in years is refused, brief flagged", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "estou com tosse");
  await p.act(c, { type: "symptom.answer", step: "symptom", value: "Concordo e quero continuar", consent: true });
  await p.say(c, "Hoje");
  await p.say(c, "Leve");
  const age = await p.say(c, "Para um bebê");
  assert.deepEqual(lastChips(age), ["Menos de 3 meses", "3 a 11 meses", "1 ano ou mais"]);
  const wrong = await p.say(c, "35 anos");
  assert.match(wrong.text, /não combina com um bebê/);
  await p.say(c, "3 a 11 meses");
  for (const answer of ["Não tenho", "Não uso outros", "Nada ainda"]) await p.say(c, answer);
  await p.say(c, "Prefiro continuar só pelo chat");
  const handoff = p.handoffs().find((h) => h.reason === "symptom")!;
  assert.equal(handoff.brief.forWhom.patient, "baby");
  assert.equal(handoff.brief.forWhom.pediatric, true);
  assert.deepEqual(handoff.brief.suggestedProducts, [], "no stock-based suggestion for a baby");
  noModelCalls();
});

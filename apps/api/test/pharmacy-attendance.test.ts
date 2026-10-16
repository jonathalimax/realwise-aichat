// Pharmacy operation mode: ATTENDANCE (AI attendant + pharmacist handoff, no catalog/stock/cart/orders)
// versus COMMERCE, and the plan rule (only plans with `pharmacyCommerce` may run commerce).
// Deterministic: stubbed model (a hostile one that would sell and quote prices), in-memory database.

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { computeOperationMode, getPlanDefinition, hasPermission, PLAN_CATALOG, pharmacyPlanHighlights } from "@realwise/shared";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { assertNoProductOrDose, createPharmacy } from "./support/pharmacy-harness";
import { loadOperationMode } from "../src/modules/pharmacy-common/operation-mode";
import { CommerceModeGuard } from "../src/modules/access/commerce-mode.guard";
import { classifyOperationModeAnswer, parseProposal } from "../src/modules/pharmacy-settings/proposals";
import { attendanceChips } from "../src/modules/chat/pharmacy/attendance";

const T = { timeout: 8000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});
void hasPermission;

const hostileModel = () => stubNetwork(llm.text("Claro! Temos dipirona em estoque por R$ 8,90. Adicionei ao carrinho."));
const PRICE_OR_STOCK = /R\$|\bem estoque\b|\bdispon[ií]vel\b.*\bagora\b|adicionei|carrinho/i;

async function attendance(extra: Parameters<typeof createPharmacy>[0] = {}) {
  return createPharmacy({ plan: "profissional", ...extra, settings: { operationMode: "attendance", ...(extra.settings ?? {}) } });
}

// ---------------------------------------------------------------------------------------------
// Plan rule + pure mode resolution
// ---------------------------------------------------------------------------------------------

test("plan catalog: pharmacyCommerce only on profissional and studio; pricing bullets for the pharmacy niche", T, () => {
  assert.deepEqual(PLAN_CATALOG.map((p) => [p.code, p.features.pharmacyCommerce]), [["essencial", false], ["profissional", true], ["studio", true]]);
  assert.match(pharmacyPlanHighlights(getPlanDefinition("essencial")!).join(" "), /atendimento/i);
  assert.match(pharmacyPlanHighlights(getPlanDefinition("profissional")!).join(" "), /pedidos/i);
});

test("effective mode: chosen, forced to attendance when the plan lacks the feature; trial = entry tier", T, () => {
  assert.equal(computeOperationMode("commerce", { code: "profissional" }).effective, "commerce");
  assert.equal(computeOperationMode("commerce", { code: "studio" }).effective, "commerce");
  const essencial = computeOperationMode("commerce", { code: "essencial" });
  assert.equal(essencial.effective, "attendance");
  assert.equal(essencial.forcedByPlan, true);
  assert.equal(essencial.upgradeToPlanCode, "profissional");
  const trial = computeOperationMode("commerce", null);
  assert.equal(trial.effective, "attendance");
  assert.equal(trial.commerceAllowedByPlan, false);
  const chosenAttendance = computeOperationMode("attendance", { code: "studio" });
  assert.equal(chosenAttendance.effective, "attendance");
  assert.equal(chosenAttendance.forcedByPlan, false);
  assert.equal(computeOperationMode(undefined, { code: "studio" }).chosen, "attendance");
});

test("commerce routes: guard answers PLAN_FEATURE (plan) or MODE_ATTENDANCE (owner's choice), never deletes data", T, async () => {
  const run = async (p: Awaited<ReturnType<typeof createPharmacy>>) => {
    const guard = new CommerceModeGuard(p.db.prisma);
    const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ member: { businessId: p.businessId } }) }) };
    try {
      return { ok: await guard.canActivate(ctx) };
    } catch (error: any) {
      return { ok: false, body: error.getResponse?.() };
    }
  };
  const commerce = await createPharmacy();
  assert.equal((await run(commerce)).ok, true);
  const chosen = await attendance();
  const chosenRes = await run(chosen);
  assert.equal(chosenRes.ok, false);
  assert.equal((chosenRes.body as any).code, "MODE_ATTENDANCE");
  const lacksPlan = await createPharmacy({ plan: "essencial" });
  const planRes = await run(lacksPlan);
  assert.equal((planRes.body as any).code, "PLAN_FEATURE");
  assert.equal((planRes.body as any).upgradeTo, "profissional");
  assert.equal((planRes.body as any).statusCode, 403);
  // Data stays: the catalog rows are still there.
  assert.ok(lacksPlan.db.models.product.rows.length > 0);
  const trial = await createPharmacy({ plan: null });
  assert.equal((await loadOperationMode(trial.db.prisma.client, trial.businessId)).effective, "attendance");
});

// ---------------------------------------------------------------------------------------------
// Chat: attendance mode
// ---------------------------------------------------------------------------------------------

test("attendance: greeting, chips and welcome never offer a cart; the AI disclosure lives in the name (Alex (IA))", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  const turn = await p.say(c, "oi");
  assert.match(turn.text, /Alex/);
  assert.doesNotMatch(turn.text, /intelig[êe]ncia artificial/i);
  assert.ok(!/pedido|carrinho/i.test(turn.text), turn.text);
  assert.deepEqual(turn.suggestions, ["Falar com o farmacêutico", "Horários e entrega", "Perguntar sobre um produto"]);
  assert.equal(turn.pharmacy.operationMode, "attendance");
  assert.equal(net.llmCalls.length, 0);
  // The scripted start also drops the "fazer um pedido" welcome and bubbles.
  const start: any = await p.flow.start(p.businessId, c.id);
  assert.ok(!/pedido/i.test(start.message), start.message);
  assert.deepEqual(start.bubbles, []);
});

test("attendance: 'tem dipirona?' / 'quanto custa' never states stock or price; request becomes a product_request handoff after consent", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  const ask = await p.say(c, "tem dipirona 500mg? quanto custa?");
  assert.ok(!PRICE_OR_STOCK.test(ask.text), ask.text);
  assert.match(ask.text, /farmac[êe]utico/i);
  assert.match(ask.text, /n[ãa]o consulto estoque nem pre[çc]o/i);
  assert.equal(p.handoffs().length, 0, "nothing is registered before the customer agrees");
  const yes = await p.say(c, "Sim, pode registrar");
  assert.ok(!PRICE_OR_STOCK.test(yes.text), yes.text);
  assert.match(yes.text, /confirma|confirmar/i);
  assert.equal(p.handoffs().length, 1);
  const h = p.handoffs()[0];
  assert.equal(h.reason, "product_request");
  assert.equal(h.urgent, false);
  assert.match(String(h.brief.requestedProduct), /dipirona/i);
  assert.match(String(h.brief.availability), /confirmar/i);
  assert.equal(p.orders().length, 0);
  assert.equal(p.db.models.order.rows.length, 0);
  assert.deepEqual(p.stateOf(c).cart, []);
  assert.equal(p.db.models.consentRecord.rows.length, 1);
  assert.deepEqual(p.db.models.consentRecord.rows[0].purposes, ["product_request"]);
  // A second request in the same conversation keeps ONE open handoff with both requests.
  p.handoffs()[0].createdAt = new Date(); // the fake clock runs in the past; the dedupe window uses real time
  await p.say(c, "e tem ibuprofeno?");
  await p.say(c, "sim");
  assert.equal(p.handoffs().length, 1);
  assert.match(String(p.handoffs()[0].brief.requestedProduct), /dipirona.*ibuprofeno/is);
  assert.equal(net.llmCalls.length, 0, "model never consulted");
});

test("attendance: bare product intent asks what is wanted; chip 'Perguntar sobre um produto'; declining registers nothing", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  const a = await p.say(c, "Perguntar sobre um produto");
  assert.match(a.text, /nome do produto/i);
  assert.equal(p.stateOf(c).awaiting.kind, "product_request");
  const b = await p.say(c, "Dorflex");
  assert.equal(p.stateOf(c).awaiting.kind, "product_request_consent");
  assert.deepEqual(b.suggestions, ["Sim, pode registrar", "Agora não"]);
  const d = await p.say(c, "agora não");
  assert.match(d.text, /n[ãa]o registrei nada/i);
  assert.equal(p.handoffs().length, 0);
  assert.equal(p.db.models.consentRecord.rows.length, 0);
  const e = await p.say(c, "quero fazer um pedido");
  assert.match(e.text, /n[ãa]o consulto estoque/i);
});

test("attendance: no product lookup, cart, checkout or prescription lane even for controlled/Rx names or card actions", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  for (const phrase of ["quero 2 dipirona 500mg", "quero amoxicilina 500mg", "quero clonazepam 2mg", "finalizar pedido", "ver carrinho", "tem novalgina?"]) {
    const turn = await p.say(c, phrase);
    assert.ok(!PRICE_OR_STOCK.test(turn.text), `${phrase}: ${turn.text}`);
    assert.ok(!turn.uis.some((u) => ["product_card", "cart", "rx_upload", "order_review", "address_capture", "contact_capture"].includes(String(u.type))), phrase);
    assert.deepEqual(p.stateOf(c).cart, [], phrase);
    assert.equal(p.stateOf(c).checkoutStep ?? null, null, phrase);
    assert.equal(p.orders().length, 0, phrase);
    assert.equal(p.db.models.prescriptionUpload.rows.length, 0, phrase);
    assert.ok(!turn.suggestions.some((s) => /carrinho|finalizar|fazer um pedido/i.test(s)), `${phrase}: ${turn.suggestions}`);
    assert.equal(turn.pharmacy.cart.itemCount, 0);
  }
  // Structured widget actions are refused politely.
  for (const action of [{ type: "cart.add", productId: "p_dipirona", qty: 1 }, { type: "checkout.start" }, { type: "checkout.confirm" }, { type: "rx.check" }]) {
    const res = await p.act(c, action);
    assert.match(res.text, /sem carrinho|farmac[êe]utico confirma/i, JSON.stringify(action));
    assert.equal(p.orders().length, 0);
    assert.deepEqual(p.stateOf(c).cart, []);
  }
  assert.equal(net.llmCalls.length, 0);
});

test("attendance: red flag still works (urgent handoff, SAMU) and beats a product question", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  const turn = await p.say(c, "estou com dor no peito, tem dipirona?");
  assert.match(turn.text, /192/);
  assert.equal(turn.uis[0]?.type, "red_flag");
  assert.equal(p.handoffs().length, 1);
  assert.equal(p.handoffs()[0].urgent, true);
  assert.equal(p.handoffs()[0].reason, "symptom");
  assert.equal(p.orders().length, 0);
});

test("attendance: symptom questionnaire -> handoff works without any catalog suggestion", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  await p.say(c, "estou com dor de cabeça");
  assert.equal(p.stateOf(c).awaiting.kind, "symptom_consent");
  await p.say(c, "Concordo e quero continuar");
  assert.equal(p.stateOf(c).awaiting.kind, "symptom_answer");
  // Walk the questionnaire with chip-like answers until it ends in a handoff.
  const answers = ["Hoje", "Leve", "Para mim", "18 a 59 anos", "Não", "Não tenho", "Não uso outros", "Nada ainda"];
  for (const answer of answers) {
    if (p.handoffs().length > 0 || !p.stateOf(c).awaiting) break;
    await p.say(c, answer);
  }
  // Contact (WhatsApp) step, if the parallel handoff feature asks for it: stay in the web chat.
  if (p.stateOf(c).awaiting?.kind === "symptom_phone") await p.say(c, "Prefiro continuar só pelo chat");
  const symptomHandoffs = p.handoffs().filter((h: any) => h.reason === "symptom");
  assert.equal(symptomHandoffs.length, 1);
  assert.deepEqual(symptomHandoffs[0].brief.suggestedProducts, [], "no stock-based suggestions in attendance mode");
  assert.equal(p.orders().length, 0);
});

test("attendance: general lane (hours, delivery, pickup, payment) answers from settings without order wording", T, async () => {
  net = hostileModel();
  const p = await attendance({ settings: { openingHours: [{ key: "weekdays", label: "Segunda a sexta", open: true, from: "08:00", to: "20:00" }], deliveryFeeCents: 600, pickupEnabled: true } });
  const c = await p.conversation();
  const hours = await p.say(c, "qual o horário de vocês?");
  assert.match(hours.text, /08:00|8h|Segunda/i);
  const delivery = await p.say(c, "vocês entregam? qual a taxa?");
  assert.match(delivery.text, /R\$ 6,00/);
  const pickup = await p.say(c, "posso retirar na loja?");
  assert.ok(!/pedido/i.test(pickup.text), pickup.text);
  const pay = await p.say(c, "quais formas de pagamento?");
  assert.ok(!/só na entrega ou na retirada/i.test(pay.text), pay.text);
  const status = await p.say(c, "onde está meu pedido?");
  assert.match(status.text, /n[ãa]o acompanho pedidos/i);
  assert.equal(net.llmCalls.length, 0);
  assertNoProductOrDose(p as any, [hours.text, delivery.text, pickup.text, pay.text, status.text], "general lane");
});

test("attendance: 'falar com o farmacêutico' keeps working (symptom lane / handoff)", T, async () => {
  net = hostileModel();
  const p = await attendance();
  const c = await p.conversation();
  const turn = await p.say(c, "quero falar com o farmacêutico");
  assert.match(turn.text, /farmac[êe]utico/i);
  assert.equal(p.stateOf(c).awaiting.kind, "symptom_consent");
  await p.say(c, "Só chamar o farmacêutico");
  assert.equal(p.handoffs().length, 1);
});

test("attendance chips filter: commerce chips dropped, 'Fazer um pedido' becomes 'Perguntar sobre um produto'", T, () => {
  assert.deepEqual(attendanceChips(["Fazer um pedido", "Falar com o farmacêutico", "Ver carrinho", "Finalizar pedido"]), ["Perguntar sobre um produto", "Falar com o farmacêutico"]);
  assert.equal(attendanceChips(["Ver carrinho"]), undefined);
});

// ---------------------------------------------------------------------------------------------
// Commerce unchanged + plan downgrade
// ---------------------------------------------------------------------------------------------

test("commerce mode unchanged: product card, cart, price from the catalog, 'Fazer um pedido' chip", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const hello = await p.say(c, "oi");
  assert.deepEqual(hello.suggestions, ["Fazer um pedido", "Falar com o farmacêutico", "Horários e entrega"]);
  assert.equal(hello.pharmacy.operationMode, "commerce");
  const add = await p.say(c, "quero 2 dipirona 500mg");
  assert.equal(p.stateOf(c).cart[0].qty, 2);
  assert.equal(add.pharmacy.cart.itemCount, 2);
  assert.equal(p.handoffs().filter((h: any) => h.reason === "product_request").length, 0);
});

test("plan downgrade forces attendance on the next turn: cart parked, no orders, data kept; upgrade restores commerce", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ plan: "profissional" });
  const c = await p.conversation();
  await p.say(c, "quero 2 dipirona 500mg");
  assert.equal(p.stateOf(c).cart.length, 1);
  const productsBefore = p.db.models.product.rows.length;
  await p.setPlan("essencial");
  const turn = await p.say(c, "finalizar pedido");
  assert.equal(turn.pharmacy.operationMode, "attendance");
  assert.deepEqual(p.stateOf(c).cart, []);
  assert.equal(p.orders().length, 0);
  assert.ok(!/R\$|carrinho/i.test(turn.text), turn.text);
  assert.equal(p.db.models.product.rows.length, productsBefore, "catalog rows are never deleted");
  assert.equal((await loadOperationMode(p.db.prisma.client, p.businessId)).forcedByPlan, true);
  // The owner's chosen mode stays "commerce": an upgrade brings it back with no action.
  await p.setPlan("studio");
  const back = await p.say(c, "oi");
  assert.equal(back.pharmacy.operationMode, "commerce");
});

test("trial / no subscription behaves as the entry plan: attendance even if 'commerce' was chosen", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ plan: null });
  const c = await p.conversation();
  const turn = await p.say(c, "quero 2 dipirona 500mg");
  assert.equal(turn.pharmacy.operationMode, "attendance");
  assert.deepEqual(p.stateOf(c).cart, []);
  assert.match(turn.text, /farmac[êe]utico/i);
});

// ---------------------------------------------------------------------------------------------
// Interview: deterministic pt-BR classifier of the operation-mode answer
// ---------------------------------------------------------------------------------------------

test("operation mode classifier (no model): commerce, attendance and ambiguous answers", T, () => {
  const commerce = ["Quero usar o estoque e vender pelo sistema", "vamos vender online, com catálogo e pedidos", "controlar estoque e receber pedidos", "comércio", "Sim, queremos vender pelo chat"];
  for (const a of commerce) assert.equal(classifyOperationModeAnswer(a), "commerce", a);
  const attendance = ["Só o atendimento com IA, escalando para o farmacêutico", "só atendimento", "sem estoque, é como um WhatsApp com IA", "não quero vender pelo sistema, só escalar pro farmacêutico", "atendimento"];
  for (const a of attendance) assert.equal(classifyOperationModeAnswer(a), "attendance", a);
  const ambiguous = ["", "não sei", "talvez", "quero vender mas por enquanto só atendimento", "sim", "ok", "estoque e só atendimento"];
  for (const a of ambiguous) assert.equal(classifyOperationModeAnswer(a), null, a);
  assert.deepEqual(parseProposal("modo_operacao", "vamos vender pelo sistema, com estoque e pedidos"), { operationMode: "commerce" });
  assert.deepEqual(parseProposal("modo_operacao", "só atendimento e escalar"), { operationMode: "attendance" });
  assert.deepEqual(parseProposal("modo_operacao", "não sei ainda"), {});
});

// ---------------------------------------------------------------------------------------------
// Interview (scripted fallback, no model) + owner confirmation in Farmácia settings
// ---------------------------------------------------------------------------------------------

import { OnboardingService } from "../src/modules/onboarding/onboarding.service";
import { PharmacySettingsService } from "../src/modules/pharmacy-settings/pharmacy-settings.service";

test("interview without a model: the operation-mode answer is classified; an ambiguous one is asked again, never saved", T, async () => {
  net = stubNetwork(llm.status(503));
  const p = await createPharmacy({ plan: "profissional" });
  const settings = new PharmacySettingsService(p.db.prisma, { record: async () => undefined } as any);
  const onboarding = new OnboardingService(p.db.prisma, settings);
  const asked = { role: "clara" as const, content: 'Pode me contar sobre "Modo de operação"?' };
  const profile = () => p.db.models.businessProfile.rows.find((r: any) => r.businessId === p.businessId)!;

  const unclear = await onboarding.interviewChat(p.businessId, [asked, { role: "owner", content: "talvez, não sei ainda" }]);
  assert.match(unclear.reply, /comércio/);
  assert.match(unclear.reply, /atendimento/);
  assert.equal(profile().data.modo_operacao, undefined, "an unclear answer is not saved");
  assert.equal(p.db.models.pharmacySettings.rows[0].proposals, undefined);

  const clear = await onboarding.interviewChat(p.businessId, [asked, { role: "owner", content: "só o atendimento com IA, escalando para o farmacêutico, sem estoque" }]);
  assert.match(clear.reply, /modo atendimento/i);
  assert.match(clear.reply, /Razão social/);
  assert.ok(profile().data.modo_operacao);
  assert.equal(p.db.models.pharmacySettings.rows[0].proposals.modo_operacao.proposed.operationMode, "attendance");
  assert.equal(p.db.models.pharmacySettings.rows[0].proposals.modo_operacao.status, "pending");
  // Nothing is applied until the owner confirms.
  assert.equal(p.db.models.pharmacySettings.rows[0].operationMode, "commerce");
});

test("settings: only the owner changes the mode; commerce on a plan without the feature is 403 PLAN_FEATURE; chosen time is recorded", T, async () => {
  const p = await createPharmacy({ plan: "essencial", settings: { operationMode: "attendance" } });
  const settings = new PharmacySettingsService(p.db.prisma, { record: async () => undefined } as any);
  const owner: any = { businessId: p.businessId, roleKey: "owner", memberId: "m1", name: "Dono", roleName: "Proprietário" };
  const manager: any = { ...owner, roleKey: "manager" };
  await assert.rejects(() => settings.update(owner, { operationMode: "commerce" }), (e: any) => e.getResponse().code === "PLAN_FEATURE" && e.getResponse().upgradeTo === "profissional");
  await p.setPlan("profissional");
  await assert.rejects(() => settings.update(manager, { operationMode: "commerce" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  const dto: any = await settings.update(owner, { operationMode: "commerce" });
  assert.equal(dto.settings.operationMode, "commerce");
  assert.ok(dto.settings.operationModeChosenAt);
  assert.equal(dto.mode.effective, "commerce");
  assert.equal(dto.mode.chosen, "commerce");
  // Downgrade: chosen stays commerce, effective is forced to attendance, banner flag set.
  await p.setPlan("essencial");
  const after: any = await settings.dto(p.businessId);
  assert.equal(after.mode.chosen, "commerce");
  assert.equal(after.mode.effective, "attendance");
  assert.equal(after.mode.forcedByPlan, true);
  assert.equal(after.mode.upgradeToPlanCode, "profissional");
  // Attendance is always allowed.
  const att: any = await settings.update(owner, { operationMode: "attendance" });
  assert.equal(att.mode.effective, "attendance");
  await assert.rejects(() => settings.update(owner, { operationMode: "banana" }), (e: any) => e.getResponse().code === "INVALID_SETTING");
});

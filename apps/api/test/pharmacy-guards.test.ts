// Pure-function tests of the pharmacy safety layer: red flags, dosage/recommendation guards, hard
// rules (class gate, auto-confirm), symptom helpers, address parsing and a scan of the fixed copy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRedFlag, isInfantWithFever } from "../src/modules/chat/pharmacy/red-flags";
import { DOSAGE_REFUSAL, asksForDosage, guardPharmacyText, guardSymptomLaneText, hasDosageAdvice, hasRecommendation } from "../src/modules/chat/pharmacy/guards";
import {
  autoConfirmDecision,
  canEnterOrder,
  describeOpeningHours,
  effectiveMaxQty,
  gateForProduct,
  isInsideDeliveryArea,
  isOpenNow,
  isSheetStale,
} from "../src/modules/chat/pharmacy/rules";
import { asksRecommendation, detectsSymptomIntent, filterSuggestions, needsDetail, nextStep, pregnancyRelevant, stepPrompt, suggestionKeywords, toList } from "../src/modules/chat/pharmacy/symptom";
import { COPY, CONSENT_TEXTS, CHIPS } from "../src/modules/chat/pharmacy/copy";
import { parseManualAddress } from "../src/modules/chat/pharmacy/pharmacy-chat.service";
import { extractQty, isAffirmative, isNegative, productTokens } from "../src/modules/chat/pharmacy/text";
import { scoreProduct } from "../src/modules/chat/pharmacy/catalog";
import { settingsView } from "../src/modules/chat/pharmacy/catalog";
import { SYMPTOM_STEPS } from "../src/modules/chat/pharmacy/symptom";

// ---------------------------------------------------------------------------------------------
// Red flags
// ---------------------------------------------------------------------------------------------

test("red flags: chest pain, breathing, overdose, seizure, infant fever, stroke, self-harm in many phrasings", () => {
  const positives = [
    "estou com dor no peito",
    "Sinto um aperto no peito forte",
    "to com dor forte no peito e no braço",
    "tô com falta de ar",
    "não consigo respirar direito",
    "meu pai está com dificuldade para respirar",
    "to sem ar",
    "acho que tomei overdose de remédio",
    "tomei muito remédio de uma vez",
    "meu filho tomou o frasco inteiro de xarope",
    "ela está convulsionando",
    "ele teve uma convulsão",
    "meu bebê está com febre",
    "bebê de 2 meses com febre alta",
    "meu filho de 3 meses está febril",
    "febre no recém-nascido",
    "ele desmaiou agora",
    "minha mãe está com a boca torta e fala enrolada",
    "quero me matar",
    "pensando em acabar com a minha vida",
    "vomitando sangue",
    "reação alérgica grave, garganta fechando",
    "bebeu água sanitária",
    "meu filho engoliu uma cartela de remédio sozinho",
    "minha filha tomou vários comprimidos escondida",
    "fui picado por uma cobra",
    "a pior dor de cabeça da minha vida",
    "dor de cabeça súbita e muito forte",
    "ele está com o pescoço duro e febre",
    "queimadura grave no braço",
    "febre de 40 graus",
  ];
  for (const text of positives) assert.ok(detectRedFlag(text), `should flag: "${text}"`);
});

test("red flags: negations and unrelated text are not flagged", () => {
  const negatives = [
    "não tenho falta de ar, só tosse leve",
    "sem dor no peito",
    "nunca tive convulsão",
    "quero dipirona 500mg",
    "qual o horário de funcionamento?",
    "minha filha tem 8 anos e está com dor de cabeça",
    "meu bebê toma vitamina D, vocês têm?",
    "estou com tosse há 3 dias",
    "febre há dois dias",
    "meu filho tomou o remédio ontem, posso comprar mais?",
    "dor de cabeça leve há 2 dias",
    "queimadura leve de sol, tem pomada?",
  ];
  for (const text of negatives) assert.equal(detectRedFlag(text), null, `should NOT flag: "${text}"`);
});

test("red flag: negation does not hide a real flag later in the sentence", () => {
  assert.ok(detectRedFlag("não sei o que fazer, estou com dor no peito"));
  assert.ok(detectRedFlag("sem febre mas com falta de ar"));
});

test("infant fever from questionnaire answers", () => {
  assert.equal(isInfantWithFever("2 meses", "febre alta"), true);
  assert.equal(isInfantWithFever("5 dias", "febre"), true);
  assert.equal(isInfantWithFever("bebê", "está quente, febre"), true);
  assert.equal(isInfantWithFever("34 anos", "febre"), false);
  assert.equal(isInfantWithFever("8 meses", "tosse"), false);
});

// ---------------------------------------------------------------------------------------------
// Dosage / recommendation guards
// ---------------------------------------------------------------------------------------------

test("dosage advice is detected and the sentence is dropped", () => {
  const bad = [
    "Tome 2 comprimidos de 8 em 8 horas.",
    "A dose recomendada é de 500 mg a cada 6 horas.",
    "Use 3 vezes ao dia depois das refeições.",
    "Aplique 10 gotas por dia.",
    "A posologia depende do peso.",
    "Pode tomar de 6 em 6 horas se a dor continuar.",
    "Dose máxima diária: 4 g.",
    "Como tomar: dissolva um sachê em água.",
    "Tome o comprimido com água.",
  ];
  for (const sentence of bad) assert.ok(hasDosageAdvice(sentence), `dosage not detected: "${sentence}"`);
  const out = guardPharmacyText("Funcionamos das 8h às 20h. Tome 2 comprimidos de 8 em 8 horas. Posso ajudar com o pedido?");
  assert.ok(!/comprimidos|8 em 8/.test(out.text), out.text);
  assert.match(out.text, /8h às 20h/);
  assert.match(out.text, /pedido/);
});

test("dosage-only text is replaced by the fixed refusal", () => {
  const out = guardPharmacyText("Tome 2 comprimidos de 8 em 8 horas.");
  assert.equal(out.replaced, true);
  assert.equal(out.text, DOSAGE_REFUSAL);
});

test("recommendations of a medicine are dropped", () => {
  const bad = ["Eu recomendo tomar dipirona.", "Você pode tomar paracetamol para isso.", "Sugiro o ibuprofeno.", "O melhor remédio é a dipirona.", "Experimente um antitérmico."];
  for (const sentence of bad) assert.ok(hasRecommendation(sentence), `recommendation not detected: "${sentence}"`);
  const out = guardPharmacyText("Posso passar você ao farmacêutico. Eu recomendo tomar dipirona.");
  assert.ok(!/dipirona/i.test(out.text), out.text);
  assert.match(out.text, /farmacêutico/);
});

test("lane E guard removes any sentence naming a catalog product term", () => {
  const out = guardSymptomLaneText("Vou passar para o farmacêutico. Muita gente usa Dipirona nesses casos.", ["dipirona", "paracetamol"]);
  assert.ok(!/dipirona/i.test(out.text), out.text);
});

test("ordinary shop facts survive the guard", () => {
  const text = "Entrega por R$ 6,00. Funcionamos das 8h às 20h. Pedido mínimo de R$ 15,00. A retirada em loja está disponível.";
  assert.equal(guardPharmacyText(text).text, text);
});

test("dosage questions are recognized", () => {
  for (const q of ["quanto devo tomar de dipirona?", "qual a dose para criança?", "de quanto em quanto tempo posso tomar?", "como tomar esse remédio", "quantos comprimidos por dia?"]) {
    assert.ok(asksForDosage(q), q);
  }
  assert.equal(asksForDosage("quero comprar dipirona"), false);
});

// ---------------------------------------------------------------------------------------------
// Hard rules
// ---------------------------------------------------------------------------------------------

const NOW = new Date();
const prod = (over: Record<string, any> = {}): any => ({
  id: "p1", businessId: "b", name: "Dipirona", presentation: null, manufacturer: null, activeIngredient: "dipirona", priceCents: 890, stockQty: 10,
  stockAsOf: NOW, saleClass: "otc", classConfirmedAt: NOW, pharmacistRequired: false, maxQtyPerOrder: 5, equivalentGroup: null, active: true, ...over,
});
const settings = (over: Record<string, any> = {}) => settingsView({ stockMaxAgeHours: 24, deliveryAreas: [], ...over });

test("class gate: only a CONFIRMED otc is orderable; controlled/unclassified never", () => {
  assert.equal(gateForProduct(prod()).kind, "otc");
  assert.equal(gateForProduct(prod({ classConfirmedAt: null })).kind, "unclassified");
  assert.equal(gateForProduct(prod({ saleClass: "unclassified", classConfirmedAt: null })).kind, "unclassified");
  assert.equal(gateForProduct(prod({ saleClass: "controlled" })).kind, "controlled");
  assert.equal(gateForProduct(prod({ saleClass: "controlled", classConfirmedAt: null })).kind, "controlled");
  assert.equal(gateForProduct(prod({ pharmacistRequired: true })).kind, "pharmacist_required");
  assert.equal(gateForProduct(prod({ saleClass: "prescription" })).kind, "prescription");
  assert.equal(gateForProduct(prod({ saleClass: "prescription", classConfirmedAt: null })).kind, "unclassified");
  assert.equal(gateForProduct(prod({ active: false })).kind, "inactive");
});

test("canEnterOrder: prescription only with an upload; controlled never", () => {
  assert.deepEqual(canEnterOrder(prod(), false), { ok: true });
  assert.equal(canEnterOrder(prod({ saleClass: "prescription" }), false).ok, false);
  assert.equal(canEnterOrder(prod({ saleClass: "prescription" }), true).ok, true);
  assert.equal(canEnterOrder(prod({ saleClass: "controlled" }), true).ok, false);
  assert.equal(canEnterOrder(prod({ saleClass: "unclassified", classConfirmedAt: null }), true).ok, false);
});

test("auto-confirm: every condition must hold", () => {
  const base = { items: [{ product: prod(), qty: 2 }], settings: settings(), fulfillment: "pickup" as const, hasPrescription: false };
  assert.equal(autoConfirmDecision(base).autoConfirm, true);
  const reasons = (patch: Record<string, any>) => autoConfirmDecision({ ...base, ...patch }).reasons;
  assert.ok(reasons({ settings: settings({ autoConfirmEnabled: false }) }).includes("auto_confirm_disabled"));
  assert.ok(reasons({ hasPrescription: true }).includes("prescription"));
  assert.ok(reasons({ items: [{ product: prod({ stockQty: 1 }), qty: 2 }] }).includes("insufficient_stock"));
  assert.ok(reasons({ items: [{ product: prod({ stockQty: null }), qty: 1 }] }).includes("insufficient_stock"));
  assert.ok(reasons({ items: [{ product: prod({ stockAsOf: new Date(Date.now() - 30 * 3600_000) }), qty: 1 }] }).includes("stale_sheet"));
  assert.ok(reasons({ items: [{ product: prod({ stockAsOf: null }), qty: 1 }] }).includes("stale_sheet"));
  assert.ok(reasons({ items: [{ product: prod({ pharmacistRequired: true }), qty: 1 }] }).includes("class_pharmacist_required"));
  assert.ok(reasons({ items: [{ product: prod({ saleClass: "prescription" }), qty: 1 }] }).includes("class_prescription"));
  assert.ok(reasons({ items: [{ product: prod(), qty: 9 }] }).includes("qty_over_limit"));
  assert.ok(reasons({ items: [{ product: prod(), qty: 1, viaEquivalentOf: "x" }] }).includes("equivalent_swap"));
  assert.ok(reasons({ requirePharmacist: true }).includes("pharmacist_requested"));
  assert.ok(reasons({ fulfillment: "delivery", address: null }).includes("outside_area"));
  assert.ok(reasons({ fulfillment: "delivery", address: { cep: "01000000", district: "X" }, settings: settings({ deliveryAreas: [{ type: "district", value: "Água Verde" }] }) }).includes("outside_area"));
  assert.equal(autoConfirmDecision({ ...base, fulfillment: "delivery", address: { cep: "80250000", district: "Água Verde" }, settings: settings({ deliveryAreas: [{ type: "district", value: "agua verde" }] }) }).autoConfirm, true);
});

test("delivery areas: district (accent/case-insensitive) and CEP prefix; empty = unrestricted", () => {
  const addr = { cep: "80250-000", district: "Água Verde" };
  assert.equal(isInsideDeliveryArea([], addr), true);
  assert.equal(isInsideDeliveryArea([{ type: "district", value: "AGUA VERDE" }], addr), true);
  assert.equal(isInsideDeliveryArea([{ type: "cep_prefix", value: "80250" }], addr), true);
  assert.equal(isInsideDeliveryArea([{ type: "cep_prefix", value: "81000" }], addr), false);
  assert.equal(isInsideDeliveryArea([{ type: "district", value: "Batel" }], addr), false);
});

test("quantity limits and stale sheet helpers", () => {
  assert.equal(effectiveMaxQty({ maxQtyPerOrder: 3 }, { maxQtyPerItemDefault: 9 }), 3);
  assert.equal(effectiveMaxQty({ maxQtyPerOrder: null }, { maxQtyPerItemDefault: 9 }), 9);
  assert.equal(effectiveMaxQty({ maxQtyPerOrder: null }, { maxQtyPerItemDefault: null }), 10);
  assert.equal(isSheetStale([{ stockAsOf: new Date() }], 24), false);
  assert.equal(isSheetStale([{ stockAsOf: new Date(Date.now() - 25 * 3600_000) }], 24), true);
  assert.equal(isSheetStale([{ stockAsOf: null }], 24), true);
});

test("opening hours: open/closed in the business time zone", () => {
  const hours = [
    { key: "weekdays", label: "Segunda a sexta", open: true, from: "08:00", to: "20:00" },
    { key: "saturday", label: "Sábado", open: true, from: "08:00", to: "18:00" },
    { key: "sunday", label: "Domingo e feriados", open: false },
  ];
  // 2026-10-14 is a Wednesday. 15:00Z = 12:00 in São Paulo (UTC-3).
  assert.equal(isOpenNow(hours, "America/Sao_Paulo", new Date("2026-10-14T15:00:00Z")), true);
  assert.equal(isOpenNow(hours, "America/Sao_Paulo", new Date("2026-10-14T01:00:00Z")), false); // 22h of Tuesday
  assert.equal(isOpenNow(hours, "America/Sao_Paulo", new Date("2026-10-18T15:00:00Z")), false); // Sunday
  assert.equal(isOpenNow([], "America/Sao_Paulo"), null);
  assert.match(describeOpeningHours(hours)!, /Domingo e feriados: fechado/);
});

// ---------------------------------------------------------------------------------------------
// Symptom lane helpers
// ---------------------------------------------------------------------------------------------

test("symptom intent and recommendation requests", () => {
  for (const t of ["estou com dor de cabeça", "to com febre desde ontem", "minha filha tem tosse", "dor de garganta", "qual remédio eu posso tomar pra dor?", "me indica algo para gripe"]) {
    assert.ok(detectsSymptomIntent(t), t);
  }
  for (const t of ["quero dipirona", "qual o horário?", "tem clonazepam?", "finalizar pedido"]) assert.equal(detectsSymptomIntent(t), false, t);
  assert.ok(asksRecommendation("qual o melhor remédio para dor de cabeça?"));
  assert.ok(asksRecommendation("o que posso tomar para azia"));
});

test("questionnaire order: one question per step, pregnancy only when relevant", () => {
  assert.deepEqual(SYMPTOM_STEPS, ["symptom", "duration", "severity", "for_whom", "age", "pregnancy", "allergies", "other_medicines", "already_tried"]);
  assert.equal(nextStep("symptom", {}), "duration");
  assert.equal(nextStep("age", { forWhom: "Para mim", age: "18 a 59 anos" }), "pregnancy");
  assert.equal(nextStep("age", { forWhom: "Para uma criança", age: "2 a 11 anos" }), "allergies");
  assert.equal(nextStep("age", { forWhom: "Para um bebê", age: "4 meses" }), "allergies");
  assert.equal(nextStep("age", { forWhom: "Para mim", age: "60 anos ou mais" }), "allergies");
  assert.equal(nextStep("already_tried", {}), "done");
  assert.equal(pregnancyRelevant({ forWhom: "Para mim", age: "25" }), true);
  assert.equal(pregnancyRelevant({ forWhom: "Para outra pessoa adulta", age: "70" }), false);
  assert.equal(needsDetail("allergies", "Tenho alergia"), true);
  assert.equal(needsDetail("allergies", "alergia a penicilina"), false);
  assert.deepEqual(toList("Não tenho"), []);
  assert.deepEqual(toList("penicilina, dipirona"), ["penicilina", "dipirona"]);
  for (const step of SYMPTOM_STEPS) assert.ok(stepPrompt(step, {}).prompt.length > 5);
});

test("pharmacist suggestions skip allergens and never target infants", () => {
  const rows = [prod({ id: "a", name: "Paracetamol 750 mg", activeIngredient: "paracetamol" }), prod({ id: "b", name: "Dipirona 500 mg", activeIngredient: "dipirona" }), prod({ id: "c", name: "Ibuprofeno 600 mg", activeIngredient: "ibuprofeno" })];
  const adult = filterSuggestions(rows, { allergies: "dipirona", forWhom: "Para mim", age: "30" });
  assert.deepEqual(adult.map((s) => s.productId), ["a", "c"]);
  const pregnant = filterSuggestions(rows, { allergies: "Não", pregnancy: "Estou grávida", forWhom: "Para mim", age: "30" });
  assert.ok(!pregnant.some((s) => s.productId === "c"));
  assert.deepEqual(filterSuggestions(rows, { forWhom: "Para um bebê", age: "5 meses" }), []);
  assert.ok(suggestionKeywords("dor de cabeça forte").includes("paracetamol"));
});

// ---------------------------------------------------------------------------------------------
// Copy scan (like the existing flow-placeholder scan): fixed copy never carries dosage or recommendations
// ---------------------------------------------------------------------------------------------

test("fixed pharmacy copy: no dosage advice, no recommendation, no unresolved placeholder", () => {
  const strings = [
    ...Object.values(COPY),
    ...Object.values(CONSENT_TEXTS),
    ...Object.values(CHIPS),
  ].filter((s) => typeof s === "string") as string[];
  assert.ok(strings.length > 40);
  for (const s of strings) {
    if (s === COPY.dosageRefusal) continue; // the refusal quotes the topic on purpose
    assert.ok(!hasDosageAdvice(s), `dosage-like copy: "${s}"`);
    assert.ok(!hasRecommendation(s), `recommendation-like copy: "${s}"`);
    assert.ok(!/\{[a-zA-Z_]+\}|undefined|\bnull\b|\[object/.test(s), `placeholder leak: "${s}"`);
  }
  // Lane E copy specifically survives the lane guard untouched.
  for (const s of [COPY.symptomIntro, COPY.symptomConsentAsk, COPY.symptomConsentRetry, COPY.handoffDone, COPY.handoffOtherDone, COPY.handoffAdded]) {
    assert.equal(guardSymptomLaneText(s, ["dipirona", "paracetamol", "ibuprofeno"]).text, s);
  }
});

// ---------------------------------------------------------------------------------------------
// Text, scoring, address parsing
// ---------------------------------------------------------------------------------------------

test("affirmative / negative detection", () => {
  for (const t of ["sim", "Sim!", "pode ser", "confirmo", "Confirmar pedido", "Concordo e quero continuar", "ok"]) assert.ok(isAffirmative(t), t);
  for (const t of ["não", "nao quero", "nunca", "Não tenho"]) assert.ok(isNegative(t), t);
  assert.equal(isAffirmative("não, obrigado"), false);
});

test("quantity extraction ignores dosage numbers", () => {
  assert.equal(extractQty("quero 2 dipirona 500mg"), 2);
  assert.equal(extractQty("duas caixas de dipirona"), 2);
  assert.equal(extractQty("dipirona 500 mg"), null);
  assert.equal(extractQty("dipirona 500 mg 10 comprimidos"), null);
  assert.equal(extractQty("3x paracetamol"), 3);
});

test("product scoring: name beats brand-by-ingredient, wrong dose is penalized, typos match", () => {
  const dip = prod({ id: "d", name: "Dipirona 500 mg", presentation: "10 comprimidos", activeIngredient: "dipirona" });
  const nov = prod({ id: "n", name: "Novalgina 500 mg", presentation: "10 comprimidos", activeIngredient: "dipirona" });
  const tokens = productTokens("quero dipirona 500mg");
  assert.ok(scoreProduct(dip, tokens, "quero dipirona 500mg") > scoreProduct(nov, tokens, "quero dipirona 500mg") + 0.12);
  assert.ok(scoreProduct(dip, productTokens("dipirona 1g"), "dipirona 1g") < scoreProduct(dip, productTokens("dipirona 500mg"), "dipirona 500mg"));
  assert.equal(scoreProduct(dip, productTokens("dor de cabeca"), "dor de cabeca"), 0);
  assert.ok(scoreProduct(dip, productTokens("dipirnoa"), "dipirnoa", true) >= 0.6);
  assert.equal(scoreProduct(dip, productTokens("dipirnoa"), "dipirnoa", false), 0);
});

test("manual address parsing (CEP provider down)", () => {
  assert.deepEqual(parseManualAddress("Rua das Flores, Água Verde, Curitiba/PR", {}), { street: "Rua das Flores", district: "Água Verde", city: "Curitiba", state: "PR" });
  assert.deepEqual(parseManualAddress("Rua X, Centro, Curitiba - pr", {}), { street: "Rua X", district: "Centro", city: "Curitiba", state: "PR" });
  assert.deepEqual(parseManualAddress("Rua X, Centro, Curitiba, PR", {}), { street: "Rua X", district: "Centro", city: "Curitiba", state: "PR" });
  assert.equal(parseManualAddress("rua x", {}), null);
  assert.deepEqual(parseManualAddress("Rua Barão", { needsStreet: true, district: "Centro", city: "Curitiba", state: "PR" }), { street: "Rua Barão", district: "Centro", city: "Curitiba", state: "PR" });
});

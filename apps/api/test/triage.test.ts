import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRIAGE_ORDER,
  detectIntent,
  describePreferences,
  extractPreferencesFromText,
  nextTriageStep,
  parseAreaAnswer,
  parseBedroomsAnswer,
  parseBudgetAnswer,
  parseNeighborhoodAnswer,
  triagePromptFragment,
  triageQuestion,
} from "../src/modules/chat/triage";

test("triage order puts bedrooms, location, size, then budget", () => {
  assert.deepEqual([...TRIAGE_ORDER], ["bedrooms", "neighborhood", "area", "budget"]);
});

test("detectIntent distinguishes rent vs buy and never guesses", () => {
  assert.equal(detectIntent("Quero alugar uma casa"), "rent");
  assert.equal(detectIntent("quero comprar um apartamento"), "buy");
  assert.equal(detectIntent("Tenho interesse em uma casa"), null);
  assert.equal(detectIntent("qual o horário de atendimento?"), null);
});

test("parseBedroomsAnswer reads digits, words and 'tanto faz'", () => {
  assert.equal(parseBedroomsAnswer("3"), 3);
  assert.equal(parseBedroomsAnswer("três quartos"), 3);
  assert.equal(parseBedroomsAnswer("2 ou 3"), 2);
  assert.equal(parseBedroomsAnswer("tanto faz"), "any");
  assert.equal(parseBedroomsAnswer("não sei ainda"), null);
});

test("parseAreaAnswer maps a typed size onto the area bucket", () => {
  assert.deepEqual(parseAreaAnswer("uns 100m²"), { areaMin: 80, areaMax: 120 });
  assert.deepEqual(parseAreaAnswer("40 metros"), { areaMax: 50 });
  assert.deepEqual(parseAreaAnswer("200"), { areaMin: 120 });
  assert.deepEqual(parseAreaAnswer("qualquer"), { areaAny: true });
  assert.equal(parseAreaAnswer("grande"), null);
});

test("parseBudgetAnswer handles R$, 'mil' and bare numbers per transaction", () => {
  assert.equal(parseBudgetAnswer("até R$ 3.000", "aluguel"), 300000);
  assert.equal(parseBudgetAnswer("3 mil", "aluguel"), 300000);
  assert.equal(parseBudgetAnswer("2500", "aluguel"), 250000);
  assert.equal(parseBudgetAnswer("500 mil", "venda"), 50000000);
  assert.equal(parseBudgetAnswer("500", "venda"), 50000000);
  assert.equal(parseBudgetAnswer("tanto faz", "venda"), "any");
  assert.equal(parseBudgetAnswer("não sei", "venda"), null);
});

test("parseNeighborhoodAnswer only accepts real places", () => {
  const known = ["Centro", "Batel", "Zona Sul"];
  assert.equal(parseNeighborhoodAnswer("no Centro", known), "Centro");
  assert.equal(parseNeighborhoodAnswer("batel", known), "Batel");
  assert.equal(parseNeighborhoodAnswer("Zona Sul", known), "Zona Sul");
  assert.equal(parseNeighborhoodAnswer("pode ser na Água Verde"), "Água Verde");
  assert.equal(parseNeighborhoodAnswer("bairro Portão"), "Portão");
  assert.equal(parseNeighborhoodAnswer("tanto faz", known), "any");
  assert.equal(parseNeighborhoodAnswer("Perto de mim", known), "any");
  for (const notAPlace of ["na verdade quero comprar", "no momento só olhando", "não quero no centro", "me mostra as opções", "aceita pet", "quero ver fotos", "Voltar ao início", "sim", "2 quartos"]) {
    assert.equal(parseNeighborhoodAnswer(notAPlace, known), null, notAPlace);
  }
  assert.equal(parseNeighborhoodAnswer("vocês aceitam pet?", known), null);
});

test("extractPreferencesFromText pulls every filter already stated", () => {
  const prefs = extractPreferencesFromText("Quero alugar uma casa de 3 quartos no bairro Centro até R$ 3.000 por mês, uns 90m2");
  assert.equal(prefs.transaction, "aluguel");
  assert.equal(prefs.bedrooms, 3);
  assert.equal(prefs.neighborhood, "Centro");
  assert.equal(prefs.budgetMaxCents, 300000);
  assert.equal(prefs.areaMin, 80);
  assert.equal(prefs.areaMax, 120);
});

test("nextTriageStep follows the configured order and skips known answers", () => {
  assert.equal(nextTriageStep({}), "bedrooms");
  assert.equal(nextTriageStep({ bedrooms: 2 }), "neighborhood");
  assert.equal(nextTriageStep({ bedrooms: 2, neighborhood: "any" }), "area");
  assert.equal(nextTriageStep({ bedrooms: 2, neighborhood: "Centro", areaAny: true }), "budget");
  assert.equal(nextTriageStep({ bedrooms: 2, neighborhood: "Centro", areaAny: true, budgetMaxCents: "any" }), null);
});

test("triage copy adapts to rent vs buy", () => {
  assert.match(triageQuestion("budget", "aluguel"), /por mês/);
  assert.match(triageQuestion("budget", "venda"), /investir/);
  assert.equal(describePreferences({ transaction: "aluguel", bedrooms: 3, neighborhood: "Centro", budgetMaxCents: 300000 }), "aluguel, 3+ quartos, Centro, até R$ 3.000/mês");
});

test("triagePromptFragment forbids the generic 'o que você quer saber' reply and names the next filter", () => {
  const fragment = triagePromptFragment("rent", { transaction: "aluguel", bedrooms: 2 });
  assert.match(fragment, /NUNCA responda com perguntas genéricas/);
  assert.match(fragment, /bairro\/região/);
  assert.match(fragment, /2\+ quartos/);
  assert.match(triagePromptFragment("buy", {}), /financiamento/);
});

import {
  isTriageEntry,
  paramsFromPreferences,
  preferencesFromParams,
  triageNodeForStep,
  triageStepForNode,
} from "../src/modules/chat/triage";

test("flow params round-trip into triage preferences", () => {
  const prefs = preferencesFromParams({ modo: "aluguel", quartos: 3, regiao: "Centro", area: 3, faixa: 2 }, () => 250000);
  assert.deepEqual(prefs, { transaction: "aluguel", bedrooms: 3, neighborhood: "Centro", areaMin: 80, areaMax: 120, budgetMaxCents: 250000 });
  assert.equal(preferencesFromParams({ regiao: "geo" }).neighborhood, undefined);
  assert.equal(preferencesFromParams({ area: "any", faixa: "any" }).areaAny, true);
  const params = paramsFromPreferences({ transaction: "venda", bedrooms: 2, budgetMaxCents: 50000000 });
  assert.equal(params.modo, "venda");
  assert.equal(params.quartos, 2);
  assert.equal(params.orcamento_max, 50000000);
  assert.ok("faixa" in params && params.faixa === undefined);
});

test("triage steps map to flow nodes and back", () => {
  assert.equal(triageNodeForStep("bedrooms", "venda"), "comprar");
  assert.equal(triageNodeForStep("bedrooms", "aluguel"), "alugar");
  assert.equal(triageNodeForStep("area"), "triagem_area");
  assert.equal(triageNodeForStep(null), "resultados");
  assert.equal(triageStepForNode("triagem_orcamento"), "budget");
  assert.equal(triageStepForNode("resultados"), null);
});

test("isTriageEntry starts a search but leaves FAQ questions alone", () => {
  assert.equal(isTriageEntry("Quero alugar uma casa"), true);
  assert.equal(isTriageEntry("vocês têm apartamento pra comprar?"), true);
  assert.equal(isTriageEntry("quero alugar, vocês aceitam pet?"), false);
  assert.equal(isTriageEntry("quanto é o IPTU pra comprar?"), false);
  assert.equal(isTriageEntry("oi"), false);
});

test("triage parsers never read filler words or long sentences as answers", () => {
  assert.equal(parseBedroomsAnswer("Quero alugar uma casa"), null);
  assert.equal(parseBedroomsAnswer("preciso de uma casa com 3 quartos"), 3);
  assert.equal(parseBedroomsAnswer("tenho 2 filhos e um cachorro grande"), null);
  assert.equal(parseBudgetAnswer("tenho 2 filhos e um cachorro grande", "venda"), null);
  assert.equal(parseAreaAnswer("moro com 2 pessoas e 10 gatos em casa"), null);
});

test("budgets in milhão / mi are read correctly", () => {
  assert.equal(parseBudgetAnswer("até 1 milhão", "venda"), 100000000);
  assert.equal(parseBudgetAnswer("1,2 mi", "venda"), 120000000);
  assert.equal(parseBudgetAnswer("2 milhões", "venda"), 200000000);
  assert.equal(parseBudgetAnswer("R$ 1 milhão", "venda"), 100000000);
  assert.equal(extractPreferencesFromText("quero comprar casa 3 quartos até R$ 1 milhão").budgetMaxCents, 100000000);
  assert.equal(extractPreferencesFromText("até 800 mil").budgetMaxCents, 80000000);
});

test("questions about the selection never restart triage", () => {
  for (const text of ["qual o valor total do aluguel?", "quanto fica o aluguel desse?", "quanto custa pra comprar esse?", "quero alugar esse que selecionei"]) {
    assert.equal(isTriageEntry(text), false, text);
  }
  assert.equal(detectIntent("posso financiar?"), null);
});

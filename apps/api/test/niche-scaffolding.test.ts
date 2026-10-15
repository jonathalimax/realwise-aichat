import { test } from "node:test";
import assert from "node:assert/strict";
import { nicheTemplates, farmaciaSettingsFieldMap } from "@realwise/profile-schema";
import { Niche } from "@realwise/db";
import { getPersona } from "../src/modules/chat/personas";
import { NICHE_BEHAVIOR, nicheBehavior } from "../src/modules/chat/niche-behavior";
import { degradedReply, gapReply, injectionDeflection, nextStepSuggestions, withNextStep, isGreeting } from "../src/modules/chat/safe-replies";
import { listingSuggestions } from "../src/modules/chat/listing-suggestions";
import { detectsFinancingSimulationIntent } from "../src/modules/chat/simulator.service";
import { selectionEngagementReply } from "../src/modules/chat/selection";
import farmaciaFlow from "../src/modules/chat/flows/farmacia.flow.json";

const NICHES = Object.values(Niche) as string[];

test("Prisma Niche enum includes farmacia and every registry covers every niche", () => {
  assert.deepEqual([...NICHES].sort(), ["concessionaria", "farmacia", "imobiliaria"]);
  for (const n of NICHES) {
    assert.ok(nicheTemplates[n as keyof typeof nicheTemplates], `template for ${n}`);
    assert.ok(NICHE_BEHAVIOR[n as keyof typeof NICHE_BEHAVIOR], `behavior for ${n}`);
    assert.ok(getPersona(n as any).name, `persona for ${n}`);
  }
});

test("pharmacy persona is Alex, discloses AI and never recommends medicine", () => {
  const p = getPersona("farmacia");
  assert.equal(p.name, "Alex");
  const welcome = p.welcome!("Farmácia Exemplo");
  assert.match(welcome, /Alex/);
  // The AI disclosure lives in the name "Alex (IA)" (widget); the welcome stays short and does not repeat it.
  assert.doesNotMatch(welcome, /inteligência artificial/);
  assert.match(welcome, /Posso montar seu pedido ou chamar o farmacêutico/);
  assert.ok(welcome.length < 130);
  assert.match(p.sharedRules, /nunca indique/i);
  assert.match(p.sharedRules, /SAMU 192/);
  assert.equal(getPersona("imobiliaria").name, "Clara");
  assert.equal(getPersona("concessionaria").name, "Tom");
  assert.ok(isGreeting("oi alex"));
});

test("pharmacy never falls into real-estate / vehicle behavior", () => {
  const b = nicheBehavior("farmacia");
  assert.equal(b.scheduling, null);
  assert.equal(b.usesListingEngine, false);
  assert.equal(b.usesRentBuyTriage, false);
  assert.equal(b.supportsFinancingSimulation, false);
  assert.equal(b.engagementEvents, "none");
  assert.deepEqual(listingSuggestions("farmacia", "aluguel"), []);
  assert.equal(detectsFinancingSimulationIntent("simular financiamento de R$ 400 mil em 48 meses", "farmacia"), false);
  assert.equal(detectsFinancingSimulationIntent("simular financiamento de R$ 400 mil em 48 meses", "imobiliaria"), true);
  const copy = [
    degradedReply("farmacia").text,
    gapReply("farmacia", false).text,
    gapReply("farmacia", true).text,
    injectionDeflection("farmacia", "Farmácia X").text,
    withNextStep("Isso eu não sei.", "farmacia", false),
    ...nextStepSuggestions("farmacia", { includeBrowse: true }),
    b.vagueInterestQuestion,
    b.honestFallback,
    b.noInventory.message,
    b.bookingFailureMessage,
  ].join(" ");
  assert.doesNotMatch(copy, /visita|imóve|imove|test-drive|corretor|vendedor|carro|veículo|financiamento/i);
  assert.match(copy, /farmacêutico/);
  assert.deepEqual(nextStepSuggestions("farmacia"), ["Falar com o farmacêutico"]);
  // selection copy is only reachable for real estate / vehicles; the pharmacy noun stays neutral
  assert.equal(selectionEngagementReply({ id: "1", title: "X", priceCents: 100 } as any, 1, "farmacia").suggestions.some((s) => /financiamento/i.test(s)), false);
});

test("real-estate and vehicle copy is unchanged", () => {
  assert.match(degradedReply("imobiliaria").text, /os imóveis disponíveis, agendar uma visita ou te passar pra um corretor\./);
  assert.match(degradedReply("concessionaria").text, /os carros disponíveis, agendar uma test-drive ou te passar pra um vendedor\./);
  assert.deepEqual(nextStepSuggestions("imobiliaria"), ["Agendar uma visita", "Falar com um corretor"]);
  assert.deepEqual(nextStepSuggestions("concessionaria", { includeBrowse: true }), ["Ver carros disponíveis", "Agendar um test-drive", "Falar com um vendedor"]);
  assert.equal(nicheBehavior("imobiliaria").scheduling?.dayNodeId, "visita_dia");
  assert.equal(nicheBehavior("concessionaria").scheduling?.dayNodeId, "agend_dia");
});

test("pharmacy flow stub: valid gotos, no placeholders, no medicine or dose advice", () => {
  const nodes = (farmaciaFlow as any).nodes as Record<string, { message: string; bubbles: { label: string; goto: string }[] }>;
  assert.ok(nodes[(farmaciaFlow as any).start]);
  const text: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    text.push(node.message);
    assert.doesNotMatch(node.message, /\{[^{}]+\}/, `placeholder in ${id}`);
    for (const b of node.bubbles) {
      assert.ok(nodes[b.goto], `${id} -> ${b.goto} missing`);
      text.push(b.label);
    }
  }
  const all = text.join(" ");
  assert.doesNotMatch(all, /\b\d+\s?(mg|ml|comprimido|gotas)\b/i);
  assert.doesNotMatch(nodes.start.message, /inteligência artificial/);
  assert.match(nodes.start.message, /Alex/);
});

test("pharmacy template: D7 questions fill declared fields and map to PharmacySettings", () => {
  const t = nicheTemplates.farmacia;
  const fields = new Set(t.fields.map((f) => f.key));
  for (const q of t.interviewQuestions) assert.ok(fields.has(q.fillsField), q.fillsField);
  for (const f of t.fields) assert.ok(t.interviewQuestions.some((q) => q.fillsField === f.key), `no question for ${f.key}`);
  for (const key of Object.keys(farmaciaSettingsFieldMap)) assert.ok(fields.has(key), key);
  assert.ok(t.evalQuestions.length >= 5);
  assert.ok(t.defaultChips.length > 0 && t.fixedFlows.length > 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isKeywordHit, rankByKeywords, residualTopicTokens, scoreChunk, tokenize } from "../src/modules/chat/kb-matching";
import { clinicalQuestion } from "../src/modules/chat/pharmacy/general-question";
import { validateQa } from "../src/modules/knowledge/knowledge-qa.service";
import { DEMO_DOCS, DEMO_QA } from "../scripts/pharmacy-demo-kb";

test("demo knowledge base: every Q&A passes the same save guards the dashboard applies", () => {
  assert.ok(DEMO_QA.length >= 35);
  for (const qa of DEMO_QA) assert.doesNotThrow(() => validateQa({ question: qa.q, answer: qa.a }), qa.q);
  assert.equal(new Set(DEMO_QA.map((q) => q.q.toLowerCase())).size, DEMO_QA.length, "no duplicate questions");
  assert.equal(DEMO_DOCS.length, 3);
});

test("wi-fi / wifi and 24h / 24 horas match each other", () => {
  assert.deepEqual(tokenize("wi-fi grátis"), tokenize("wifi gratis"));
  assert.ok(tokenize("abertos 24h").includes(tokenize("funcionam 24 horas")[tokenize("funcionam 24 horas").length - 1]));
});

test("one distinctive word that carries the question matches (vacina de gripe -> vacinas), a generic one does not", () => {
  const chunk = "Pergunta: Vocês aplicam vacinas?\nResposta: Ainda não aplicamos vacinas na loja.";
  assert.ok(isKeywordHit(scoreChunk(tokenize("vocês têm vacina de gripe?"), chunk)));
  assert.equal(rankByKeywords("vocês vendem bicicleta?", [{ content: chunk }]).length, 0);
  assert.equal(rankByKeywords("vocês têm loja em São Paulo?", [{ content: chunk }]).length, 0);
});

test("residual topic tokens drop the generic store-info words only", () => {
  assert.deepEqual(residualTopicTokens("qual o horário de funcionamento?"), []);
  assert.deepEqual(residualTopicTokens("qual a taxa de entrega?"), []);
  assert.ok(residualTopicTokens("entregam em condomínio?").length >= 1);
  assert.ok(residualTopicTokens("dá pra pagar com ticket alimentação?").length >= 1);
  assert.ok(residualTopicTokens("em quanto tempo chega a entrega?").length >= 1);
});

test("asking whether the store measures blood pressure is a service question, health words still escalate", () => {
  assert.equal(clinicalQuestion("Vocês medem pressão arterial?"), false);
  assert.equal(clinicalQuestion("vocês fazem teste de diabetes? quanto custa?"), false);
  assert.equal(clinicalQuestion("minha pressão está alta, vocês medem?"), true);
  assert.equal(clinicalQuestion("qual remédio para pressão?"), true);
  assert.equal(clinicalQuestion("vocês medem a pressão de quem tem febre?"), true);
});

import { briefHasHealthConsent } from "../src/modules/handoffs/handoff-dto";
test("handoff detail only claims the health-data consent when the visitor gave it", () => {
  assert.equal(briefHasHealthConsent({ customerRequest: "Cliente pediu para falar com o farmacêutico.", conversationLink: "/c" }), false);
  assert.equal(briefHasHealthConsent({ symptoms: "Tosse seca", duration: "4 dias", forWhom: { relation: "Própria pessoa" } }), true);
  assert.equal(briefHasHealthConsent({ symptoms: "Dor no peito", customerText: "meu pai está com dor forte", redFlags: ["Dor no peito"] }), false);
  assert.equal(briefHasHealthConsent(null), false);
});

import { pharmacyThemeVars } from "../../chat/src/lib/pharmacy-theme";
test("brand colours: text on the default amber is dark (WCAG), on the dark teal it stays white", () => {
  const vars = pharmacyThemeVars(null) as Record<string, string>;
  assert.equal(vars["--ph-tertiary-fg"], "#09090b");
  assert.equal(vars["--ph-primary-fg"], "#ffffff");
  assert.equal(vars["--ph-secondary-fg"], "#ffffff");
  const light = pharmacyThemeVars({ primaryColor: "#FDE68A", secondaryColor: "#0B4F4A", tertiaryColor: "#F59E0B" } as never) as Record<string, string>;
  assert.equal(light["--ph-primary-fg"], "#09090b");
});

import { previewText } from "../../dashboard/src/lib/format";
test("conversation list preview shows plain text, not the chat's light markdown", () => {
  const p = previewText("Claro! Aqui está:\n\n**Horário de atendimento**\n- Segunda a sexta: 08:00 às 22:00");
  assert.doesNotMatch(p, /\*\*/);
  assert.doesNotMatch(p, /(^|\s)- /);
  assert.match(p, /Horário de atendimento/);
});

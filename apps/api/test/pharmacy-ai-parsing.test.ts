import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, extractJsonValue } from "../src/inference/json-extract";
import { parseModelMapping } from "../src/modules/catalog-import/column-mapping";
import { GatewayCatalogModel } from "../src/modules/catalog-import/catalog-model";
import { PharmacyNotificationsService, firstNameOf, handoffAlertMessage } from "../src/modules/pharmacy-notifications/pharmacy-notifications.service";

const headers = ["Cód. Barras", "Descrição", "Preço Custo", "Preço Venda"];
const sample = [["7891234567890", "Dipirona 500mg", "4,10", "9,90"]];
const ARRAY = '[{"index":0,"field":"ean","confidence":0.95},{"index":1,"field":"name","confidence":0.98},{"index":2,"field":"ignore","confidence":0.9},{"index":3,"field":"price","confidence":0.97}]';

test("extractJsonObject strips fences, <think> blocks and surrounding prose", () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('<think>vou pensar {x}</think>\nAqui está: {"reply":"oi {você}","n":{"k":2}} fim'), { reply: "oi {você}", n: { k: 2 } });
  assert.deepEqual(extractJsonObject('lixo { quebrado } {"ok":true}'), { ok: true });
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject("sem json"), null);
  assert.equal(extractJsonObject('{"a":'), null);
});

test("extractJsonValue accepts a bare array", () => {
  assert.deepEqual(extractJsonValue(`Resposta:\n\`\`\`\n[{"i":0}]\n\`\`\``), [{ i: 0 }]);
});

test("parseModelMapping accepts a bare array, fenced and wrapped answers", () => {
  for (const text of [ARRAY, `\`\`\`json\n{"columns":${ARRAY}}\n\`\`\``, `<think>hmm</think>${ARRAY}`]) {
    const cols = parseModelMapping(text, headers, sample)!;
    assert.deepEqual(cols.map((c) => c.field), ["ean", "name", "ignore", "price"]);
  }
  assert.equal(parseModelMapping("não sei", headers, sample), null);
});

function stubGateway(answers: string[]) {
  const calls: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const text = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(JSON.stringify({ text, provider: "managed", model: "stub", inputTokens: 1, outputTokens: 1, latencyMs: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("GatewayCatalogModel.mapColumns: reasoning-sized budget, retries an empty answer once, then succeeds", async () => {
  const g = stubGateway(["", ARRAY]);
  try {
    const cols = await new GatewayCatalogModel().mapColumns("b1", headers, sample);
    assert.deepEqual(cols?.map((c) => c.field), ["ean", "name", "ignore", "price"]);
    assert.equal(g.calls.length, 2);
    assert.ok(g.calls[0].maxTokens >= 2000, "max_tokens must leave room for hidden reasoning");
    assert.ok(g.calls[1].maxTokens > g.calls[0].maxTokens);
  } finally {
    g.restore();
  }
});

test("GatewayCatalogModel.mapColumns returns null only when both attempts are unusable", async () => {
  const g = stubGateway(["", "desculpe"]);
  try {
    assert.equal(await new GatewayCatalogModel().mapColumns("b1", headers, sample), null);
    assert.equal(g.calls.length, 2);
  } finally {
    g.restore();
  }
});

test("GatewayCatalogModel.proposeClasses tolerates fences and a bare array", async () => {
  const g = stubGateway(['```json\n[{"i":0,"class":"prescription","confidence":"high"}]\n```']);
  try {
    const out = await new GatewayCatalogModel().proposeClasses("b1", [{ key: "k1", name: "Amoxicilina 500mg" }]);
    assert.deepEqual(out.get("k1"), { class: "prescription", confidence: "high" });
  } finally {
    g.restore();
  }
});

test("handoff alert text names the first name and a non-clinical reason only", () => {
  assert.equal(firstNameOf("  Maria da Silva "), "Maria");
  assert.equal(firstNameOf("123 !!"), null);
  assert.equal(handoffAlertMessage(true, "Maria", "symptom"), "Atendimento farmacêutico URGENTE de Maria (dúvida clínica) aguardando resposta");
  assert.equal(handoffAlertMessage(false, null, "other"), "Novo atendimento farmacêutico aguardando resposta");
});

test("newHandoff creates one alert per handoff (dedupes repeats), distinct handoffs stay separate", async () => {
  const alerts: any[] = [];
  const prisma: any = {
    client: {
      businessAlert: {
        findFirst: async ({ where }: any) => alerts.find((a) => a.actionHref === where.actionHref && a.businessId === where.businessId && !a.dismissedAt) ?? null,
        create: async ({ data }: any) => (alerts.push({ ...data }), data),
      },
      pharmacistHandoff: { findFirst: async () => ({ leadId: "l1" }) },
      lead: { findFirst: async () => ({ name: "João Pereira" }) },
      business: { findUnique: async () => ({ email: null }) },
      businessMember: { findMany: async () => [] },
    },
  };
  const svc = new PharmacyNotificationsService(prisma, {} as any);
  await svc.notify({ type: "new_handoff", businessId: "b1", handoffId: "h1", urgent: true, reason: "symptom" });
  await svc.notify({ type: "new_handoff", businessId: "b1", handoffId: "h1", urgent: true, reason: "symptom" });
  await svc.notify({ type: "new_handoff", businessId: "b1", handoffId: "h2", urgent: true, reason: "rx" });
  assert.equal(alerts.length, 2);
  assert.match(alerts[0].message, /URGENTE de João \(dúvida clínica\)/);
  assert.notEqual(alerts[0].message, alerts[1].message);
  assert.equal(alerts[0].severity, "critical");
});

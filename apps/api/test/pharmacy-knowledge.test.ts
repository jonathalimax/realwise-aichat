// Pharmacy knowledge base: permission defaults, keyword matching, Q&A CRUD scoped by business, guards on saved answers,
// "Testar o Alex" (no side effects) and proof that a Q&A saved from the dashboard is what Alex answers with.

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005/chat";
// No embedder in tests: Q&A is stored without vectors and found by keyword.
process.env.OLLAMA_URL = "http://127.0.0.1:9";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { buildStarterPermissions, hasPermission, NICHE_SECTIONS, SECTION_LABELS } from "@realwise/shared";
import { createFakePrisma, llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { createPharmacy } from "./support/pharmacy-harness";
import { KnowledgeController } from "../src/modules/knowledge/knowledge.controller";
import { KnowledgeQaService, answerOfQaChunk, validateQa } from "../src/modules/knowledge/knowledge-qa.service";
import { REQUIRE_PERMISSION_KEY, type RequiredPermission } from "../src/modules/access/permission.decorator";
import { rankByKeywords, stem, tokenize } from "../src/modules/chat/kb-matching";
import { retrieveChunksForChat } from "../src/modules/chat/knowledge-retrieval";
import type { MemberContext } from "../src/modules/access/member-context";

const T = { timeout: 15000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});

// ---------------------------------------------------------------- permissions
test("pharmacy starter grids: conhecimento owner/manager/pharmacist edit, attendant view, courier none", () => {
  assert.ok(NICHE_SECTIONS.farmacia.includes("conhecimento"));
  assert.equal(SECTION_LABELS.conhecimento, "Base de conhecimento");
  const level = (k: "owner" | "pharmacist" | "manager" | "attendant" | "courier") => buildStarterPermissions("farmacia", k).conhecimento;
  assert.deepEqual(["owner", "manager", "pharmacist", "attendant", "courier"].map((k) => level(k as any)), ["edit", "edit", "edit", "view", "none"]);
});

test("knowledge routes: reads need view, writes need edit", () => {
  const reflector = new Reflector();
  const need = (method: string) => reflector.getAllAndOverride<RequiredPermission>(REQUIRE_PERMISSION_KEY, [(KnowledgeController as any).prototype[method], KnowledgeController]);
  for (const m of ["listQa", "testAlex", "listOpenQuestions", "listDocuments"]) assert.deepEqual([need(m).sections, need(m).level], [["conhecimento"], "view"], m);
  for (const m of ["createQa", "updateQa", "deleteQa", "uploadFile", "deleteDocument"]) assert.deepEqual([need(m).sections, need(m).level], [["conhecimento"], "edit"], m);
  const attendant = buildStarterPermissions("farmacia", "attendant");
  assert.ok(hasPermission(attendant, "conhecimento", "view") && !hasPermission(attendant, "conhecimento", "edit"));
  assert.ok(!hasPermission(buildStarterPermissions("farmacia", "courier"), "conhecimento", "view"));
});

// ---------------------------------------------------------------- keyword matching
test("stemming folds accents, plurals, diminutives and noun/verb endings", () => {
  assert.equal(stem("estacionamento"), stem("estacionar"));
  assert.equal(stem("estacionamentos"), stem("estacionamento"));
  assert.equal(stem("Condomínios"), stem("condominio"));
  assert.equal(stem("caixinhas"), stem("caixa"));
  assert.notEqual(stem("cachorro"), stem("animais"));
});

test("keyword ranking: stems match, unrelated words do not, best chunk first", () => {
  const chunks = [
    { content: "Aceitamos Pix e cartão de crédito ou débito." },
    { content: "Pergunta: Vocês têm estacionamento?\nResposta: Sim, gratuito para clientes." },
    { content: "Entregamos em todo o bairro Água Verde, de segunda a sábado." },
  ];
  assert.match(rankByKeywords("onde posso estacionar o carro?", chunks)[0].content, /estacionamento/);
  assert.match(rankByKeywords("TEM ESTACIONAMENTOS aí", chunks)[0].content, /estacionamento/);
  assert.match(rankByKeywords("vocês entregam no Água Verde?", chunks)[0].content, /Entregamos/);
  // Different topic: nothing is grounded on a single generic word.
  assert.equal(rankByKeywords("vocês aceitam cachorro na loja?", [{ content: "Atendemos animais de estimação? Não vendemos ração." }]).length, 0);
  assert.equal(rankByKeywords("cachorro", [{ content: "Cuidados com animais" }]).length, 0);
  assert.ok(tokenize("Vocês têm o quê?").length <= 1);
  // A distinctive topic word is enough even in a long, chatty question; short generic ones are not.
  const toys = [{ content: "Pergunta: Vocês têm brinquedoteca?\nResposta: Sim, um cantinho infantil." }];
  assert.equal(rankByKeywords("vocês têm brinquedoteca para as crianças esperarem?", toys).length, 1);
  assert.equal(rankByKeywords("vocês vendem pet shop?", [{ content: "Vendemos medicamentos e perfumaria." }]).length, 0);
});

// ---------------------------------------------------------------- guards on saved answers
test("saved Q&A: dosage, clinical content, recommendations and personal data are refused", () => {
  const code = (q: string, a: string) => {
    try {
      validateQa({ question: q, answer: a });
      return "ok";
    } catch (e: any) {
      return e.getResponse().code as string;
    }
  };
  assert.equal(code("Vocês têm estacionamento?", "Sim, gratuito para clientes."), "ok");
  assert.equal(code("Como tomar dipirona?", "Tome 1 comprimido de 500 mg a cada 6 horas."), "DOSAGE_CONTENT");
  assert.equal(code("Vocês têm estacionamento?", "Sim. E para a dor tome 1 comprimido de 500 mg de 8 em 8 horas."), "DOSAGE_CONTENT");
  assert.equal(code("Qual remédio para dor de cabeça?", "Aqui temos de tudo."), "CLINICAL_CONTENT");
  assert.equal(code("Vocês têm algo bom?", "Eu recomendo o xarope da casa."), "RECOMMENDATION_CONTENT");
  assert.equal(code("O cliente Carlos está cadastrado?", "Sim, CPF 123.456.789-09."), "PERSONAL_DATA");
  assert.equal(code("Oi", "Sim"), "INVALID_QUESTION");
});

// ---------------------------------------------------------------- CRUD scoped by business
function member(businessId: string, permissions = buildStarterPermissions("farmacia", "owner")): MemberContext {
  return { memberId: `m-${businessId}`, businessId, niche: "farmacia", name: "Dono", email: null, crf: null, roleId: "r", roleKey: "owner", roleName: "Proprietário", requiresCrf: false, ownDeliveriesOnly: false, permissions };
}

const rowsOf = (db: { models: Record<string, any> }, name: string): any[] => db.models[name]?.rows ?? [];

function service(db = createFakePrisma(), replies: unknown[] = []) {
  const accessLog: any = { record: async () => undefined };
  return { svc: new KnowledgeQaService(db.prisma, accessLog), db, replies };
}

test("Q&A CRUD is scoped by businessId and stored as keyword-searchable chunks", T, async () => {
  const { svc, db } = service();
  const a = member("biz-a");
  const b = member("biz-b");
  const created = await svc.create(a, { question: "Vocês têm estacionamento?", answer: "Sim, gratuito para clientes." });
  assert.equal(created.question, "Vocês têm estacionamento?");
  assert.equal((await svc.list("biz-a")).items.length, 1);
  assert.equal((await svc.list("biz-b")).items.length, 0);
  // The other business can neither edit nor delete it.
  await assert.rejects(() => svc.update(b, created.id, { question: "Vocês têm estacionamento?", answer: "Não." }), /não encontrada/);
  await assert.rejects(() => svc.remove(b, created.id), /não encontrada/);
  // Duplicate question (accent / case insensitive) is refused.
  await assert.rejects(() => svc.create(a, { question: "voces tem ESTACIONAMENTO", answer: "Sim." }), (e: any) => e.getResponse().code === "DUPLICATE_QUESTION");
  const chunk = rowsOf(db, "knowledgeChunk").find((r: any) => r.businessId === "biz-a");
  assert.equal(answerOfQaChunk(chunk!.content), "Sim, gratuito para clientes.");
  const updated = await svc.update(a, created.id, { question: "Vocês têm estacionamento?", answer: "Sim, 12 vagas gratuitas." });
  assert.equal(updated.answer, "Sim, 12 vagas gratuitas.");
  assert.equal(rowsOf(db, "knowledgeChunk").filter((r: any) => r.documentId === created.id).length, 1);
  await svc.remove(a, created.id);
  assert.equal((await svc.list("biz-a")).items.length, 0);
  assert.equal(rowsOf(db, "knowledgeChunk").length, 0);
});

test("a refused save leaves nothing behind", T, async () => {
  const { svc, db } = service();
  await assert.rejects(() => svc.create(member("biz-a"), { question: "Como usar o xarope?", answer: "Tome 2 colheres de 8 em 8 horas." }));
  assert.equal(rowsOf(db, "knowledgeDocument").length, 0);
});

// ---------------------------------------------------------------- Testar o Alex
test("Testar o Alex answers from a saved Q&A and creates no conversation, message or handoff", T, async () => {
  net = stubNetwork(llm.text("Essa informação eu não tenho."));
  const { svc, db } = service();
  await svc.create(member("biz-a"), { question: "Vocês têm estacionamento?", answer: "Sim, gratuito para clientes." });
  await svc.create(member("biz-b"), { question: "Vocês têm estacionamento?", answer: "Não." });
  const hit = await svc.testAlex("biz-a", "tem onde estacionar?");
  assert.equal(hit.outcome, "answer");
  assert.equal(hit.answer, "Sim, gratuito para clientes.");
  assert.equal(hit.sources[0].kind, "qa");
  assert.equal(hit.sources[0].used, true);
  const miss = await svc.testAlex("biz-a", "vocês vendem pet shop?");
  assert.equal(miss.outcome, "team");
  const clinical = await svc.testAlex("biz-a", "quanto devo tomar de dipirona?");
  assert.equal(clinical.outcome, "pharmacist");
  for (const model of ["conversation", "message", "pharmacistHandoff"]) assert.equal((db.models[model]?.rows ?? []).length, 0, model);
});

test("Responder e salvar: replies to the customer and stores the Q&A; a refused save sends nothing", T, async () => {
  const replies: any[] = [];
  const { svc, db } = service(createFakePrisma(), replies);
  const m = member("biz-a");
  const reply = async (text: string) => (replies.push(text), { ok: true });
  const handoff = await db.models.pharmacistHandoff.create({ data: { businessId: "biz-a", reason: "general_question", status: "open", summary: "tem wifi?", brief: { question: "tem wifi para clientes?" } } });
  await db.models.pharmacistHandoff.create({ data: { businessId: "biz-b", reason: "general_question", status: "open", summary: "outra", brief: {} } });
  assert.equal((await svc.listOpenQuestions("biz-a")).items.length, 1);

  await assert.rejects(() => svc.answerOpenQuestion(m, handoff.id, { answer: "Tome 1 comprimido de 500 mg a cada 8 horas." }, reply));
  assert.equal(replies.length, 0);
  assert.equal(rowsOf(db, "knowledgeDocument").length, 0);

  const done = await svc.answerOpenQuestion(m, handoff.id, { answer: "Temos wi-fi gratuito.", question: "Vocês têm wi-fi?" }, reply);
  assert.equal(replies.length, 1);
  assert.equal(done.saved?.question, "Vocês têm wi-fi?");
  assert.equal((await svc.list("biz-a")).items.length, 1);

  // Another business' handoff is invisible; an attendant without Atendimento edit cannot answer.
  await assert.rejects(() => svc.answerOpenQuestion(member("biz-b"), handoff.id, { answer: "Sim." }, reply), /não encontrada/);
  const noEdit = member("biz-a", { ...buildStarterPermissions("farmacia", "attendant"), atendimento: "view" });
  await assert.rejects(() => svc.answerOpenQuestion(noEdit, handoff.id, { answer: "Sim." }, reply), (e: any) => e.getResponse().code === "PERMISSION_DENIED");
});

test("retrieval without any embedding falls back to stem-aware keyword matching over the tenant's chunks", T, async () => {
  net = stubNetwork(llm.text("x"));
  const { svc, db } = service();
  await svc.create(member("biz-a"), { question: "Vocês têm estacionamento?", answer: "Sim, gratuito para clientes." });
  await svc.create(member("biz-b"), { question: "Vocês têm estacionamento?", answer: "Não." });
  const r = await retrieveChunksForChat(db.prisma, "biz-a", "farmacia", "onde posso estacionar?");
  assert.equal(r.tenant.length, 1);
  assert.match(r.tenant[0].content, /gratuito/);
  assert.equal((await retrieveChunksForChat(db.prisma, "biz-a", "farmacia", "vocês aceitam cachorro?")).tenant.length, 0);
});

// ---------------------------------------------------------------- eval: a Q&A saved from the dashboard is what Alex uses
test("quality eval: a Q&A saved from the dashboard answers the customer, no escalation", T, async () => {
  net = stubNetwork(llm.text("Temos sim! O estacionamento é gratuito para clientes."));
  const p = await createPharmacy({ settings: { openingHours: [], deliveryAreas: [], paymentMethods: ["pix"] } });
  const { svc } = service(p.db);
  await svc.create(member(p.businessId), { question: "Vocês têm estacionamento?", answer: "Sim, gratuito para clientes." });
  const c = await p.conversation();
  const turn = await p.say(c, "tem estacionamento para clientes?", { allowDegraded: true });
  const all = turn.texts.join(" | ");
  assert.match(all, /estacionamento é gratuito/);
  assert.doesNotMatch(all, /não tenho essa informação|equipe da farmácia confirmar|pedir para a equipe/i);
  assert.equal(p.handoffs().filter((h: any) => h.reason === "general_question").length, 0);
  // The chunk the model grounded on is the saved Q&A (no vectors involved).
  assert.ok(rowsOf(p.db, "knowledgeChunk").some((r: any) => /Resposta: Sim, gratuito/.test(r.content)));
});

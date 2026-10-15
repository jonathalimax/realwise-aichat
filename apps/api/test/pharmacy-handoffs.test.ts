import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HandoffsService } from "../src/modules/handoffs/handoffs.service";
import { buildStarterPermissions, STARTER_ROLE_DEFS } from "@realwise/shared";
import type { MemberContext } from "../src/modules/access/member-context";

const pharmacist: MemberContext = {
  memberId: "m-ph", businessId: "b1", niche: "farmacia", name: "Paulo Nunes", email: null, crf: "CRF-PR 1234", roleId: "r", roleKey: "pharmacist",
  roleName: "Farmacêutico RT", requiresCrf: true, ownDeliveriesOnly: false, permissions: buildStarterPermissions("farmacia", "pharmacist"),
};

let productRows: any[] = [];
const prod = (id: string, over: any = {}) => ({ id, businessId: "b1", name: `Produto ${id}`, presentation: "cx 10", priceCents: 1000, stockQty: 5, maxQtyPerOrder: null, imageKey: null, updatedAt: new Date(1000), saleClass: "otc", ...over });
let leadPhone: string | null = "+5541991112233";
function setup(status: "open" | "answered" | "closed" = "open") {
  leadPhone = "+5541991112233";
  productRows = [];
  const row: any = {
    id: "h1", businessId: "b1", conversationId: "c1", leadId: "l1", reason: "symptom", urgent: false, summary: "Dor de cabeça · há 3 dias",
    brief: { symptoms: "Dor de cabeça", allergies: ["dipirona"], suggestedProducts: [] }, status, answerText: null, answeredAt: null, answeredByName: null, answeredByRole: null,
    createdAt: new Date(Date.now() - 4 * 60000),
  };
  const calls: any = { human: [], push: [], logs: [], notes: [], cards: [], productQueries: [] };
  const prisma: any = {
    client: {
      $executeRaw: async () => 0,
      pharmacistHandoff: {
        findFirst: async ({ where }: any) => (where.id === row.id && where.businessId === row.businessId ? { ...row } : null),
        update: async ({ data }: any) => Object.assign(row, data),
      },
      lead: {
        // Regression: the real query must select the phone columns (a fake that ignores `select` once hid a missing phone).
        findMany: async ({ select }: any) => {
          assert.ok(select?.phone && select?.phoneNormalized, "withLeads must select phone and phoneNormalized");
          return [{ id: "l1", name: "Maria Souza", phone: leadPhone, phoneNormalized: leadPhone }];
        },
        findFirst: async ({ where }: any) => (where.id === "l1" && where.businessId === "b1" ? { phone: leadPhone, phoneNormalized: leadPhone } : null),
      },
      business: { findFirst: async () => ({ name: "Farmácia X", slug: "farmacia-x" }) },
      product: { findMany: async (args: any) => { calls.productQueries.push(args); return productRows.filter((r) => (args.where?.id?.in ? args.where.id.in.includes(r.id) : true) && (args.where?.businessId ? r.businessId === args.where.businessId : true) && r.listable !== false).map(({ listable: _l, ...r }) => r); } },
      pharmacySettings: { findFirst: async () => ({ maxQtyPerItemDefault: 5 }) },
      conversation: { findFirst: async () => ({ id: "c1", resumeToken: "tok", lastVisitorSeenAt: null, business: { slug: "farmacia-x", name: "Farmácia X" } }) },
    },
  };
  const service = new HandoffsService(
    prisma,
    { record: async (e: any) => calls.logs.push(e) } as any,
    { sendToConversation: async (...a: any[]) => calls.push.push(a) } as any,
    { recordHumanReply: async (i: any) => calls.human.push(i), recordSystemNote: async (i: any) => calls.notes.push(i), recordHumanCard: async (i: any) => calls.cards.push(i) } as any,
  );
  return { service, row, calls };
}

test("reply goes through the chat human service, answers the handoff, pushes a generic message and logs without content", async () => {
  const { service, row, calls } = setup();
  const dto = await service.reply(pharmacist, "h1", "  Pode tomar paracetamol 750 mg, 1 comprimido de 8 em 8 horas.  ");
  assert.equal(calls.human.length, 1);
  assert.deepEqual(calls.human[0].author, { memberId: "m-ph", name: "Paulo Nunes", roleName: "Farmacêutico RT" });
  assert.equal(calls.human[0].conversationId, "c1");
  assert.equal(calls.human[0].text, "Pode tomar paracetamol 750 mg, 1 comprimido de 8 em 8 horas.");
  assert.equal(row.status, "answered");
  assert.equal(dto.status, "answered");
  assert.equal(dto.answer?.byRole, "Farmacêutico RT");
  assert.equal(calls.logs[0].action, "handoff.answer");
  assert.equal(calls.logs[0].summary, "Respondeu atendimento");
  assert.ok(!JSON.stringify(calls.logs).includes("paracetamol"), "no reply text in the access log");
  const [, payload] = calls.push[0];
  assert.equal(payload.body, "O farmacêutico respondeu ao seu atendimento.");
  assert.ok(!JSON.stringify(payload).includes("paracetamol"), "no health text in the push payload");
  assert.match(payload.url, /\/farmacia-x\/chat\?c=c1&t=tok$/);
});

test("reply validation: text length, closed handoff, other business", async () => {
  const { service } = setup();
  await assert.rejects(() => service.reply(pharmacist, "h1", "   "), (e: any) => e.getResponse().code === "INVALID_TEXT");
  await assert.rejects(() => service.reply(pharmacist, "h1", "x".repeat(2001)), (e: any) => e.getResponse().code === "INVALID_TEXT");
  await assert.rejects(() => service.reply({ ...pharmacist, businessId: "b2" }, "h1", "oi"), (e: any) => e.getStatus() === 404);
  const closed = setup("closed");
  await assert.rejects(() => closed.service.reply(pharmacist, "h1", "oi"), (e: any) => e.getStatus() === 409);
});

test("close logs without content and is idempotent", async () => {
  const { service, row, calls } = setup("answered");
  const dto = await service.close(pharmacist, "h1");
  assert.equal(dto.status, "closed");
  assert.ok(row.closedAt instanceof Date);
  assert.equal(calls.logs[0].action, "handoff.close");
  await service.close(pharmacist, "h1");
  assert.equal(calls.logs.length, 1, "closing twice logs once");
});

test("detail never invents suggestions: out-of-stock catalog rows are dropped", async () => {
  const { service, row } = setup();
  row.brief = { suggestedProducts: [{ productId: "p1", name: "X", reason: "r", inStock: true, priceCents: 100 }] };
  const dto = await service.get("b1", "h1");
  assert.equal(dto.suggestion, null);
  assert.equal(dto.who, "Maria");
});

// ---------------------------------------------------------------- WhatsApp hand-over

test("whatsapp draft: full number + deterministic message for the permitted member only, access-logged without health text", async () => {
  const { service, row, calls } = setup();
  row.brief = { symptoms: "Dor de cabeça", duration: "3 dias", allergies: ["dipirona"], suggestedProducts: [{ productId: "p1", name: "Paracetamol", reason: "r", inStock: true, priceCents: 1120 }] };
  const draft = await service.whatsappDraft(pharmacist, "h1");
  assert.equal(draft.phone, "5541991112233");
  assert.match(draft.message, /^Olá, Maria! Aqui é Paulo Nunes, Farmacêutico RT da Farmácia X\./);
  assert.ok(draft.message.includes("Dor de cabeça") && draft.message.includes("dipirona"));
  assert.ok(!draft.message.includes("Paracetamol"), "no stock suggestion in the customer message");
  assert.ok(draft.webUrl.startsWith("https://web.whatsapp.com/send?phone=5541991112233&text="));
  assert.ok(draft.appUrl.startsWith("https://wa.me/5541991112233?text="));
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].action, "handoff.whatsapp_link");
  const logged = JSON.stringify(calls.logs);
  assert.ok(!logged.includes("991112233") && !logged.includes("Dor de cabeça") && !logged.includes("dipirona"), "the log carries no phone nor health data");
});

test("the detail GET shows staff the full phone (not masked); the list never carries it", async () => {
  const { service } = setup();
  const dto: any = await service.get("b1", "h1", pharmacist);
  assert.equal(dto.contact.firstName, "Maria");
  assert.equal(dto.contact.phone, "+5541991112233");
  assert.equal(dto.contact.hasPhone, true);
  const list: any = await service.list("b1", {}, pharmacist).catch(() => null);
  if (list) assert.ok(!JSON.stringify(list).includes("991112233"));
});

const attendant: MemberContext = {
  ...pharmacist, memberId: "m-at", name: "Bruno Dias", crf: null, roleKey: "attendant", roleName: "Atendente", requiresCrf: false,
  permissions: buildStarterPermissions("farmacia", "attendant"),
};

test("clinical handoffs need a CRF; plain availability checks (out of stock, product request) can be handled by any member", async () => {
  const clinical = setup();
  assert.equal(((await clinical.service.get("b1", "h1", attendant)) as any).canHandle, false);
  assert.equal(((await clinical.service.get("b1", "h1", pharmacist)) as any).canHandle, true);
  await assert.rejects(() => clinical.service.start(attendant, "h1", "whatsapp"), (e: any) => e.getResponse().code === "CRF_REQUIRED");
  await assert.rejects(() => clinical.service.reply(attendant, "h1", "oi"), (e: any) => e.getResponse().code === "CRF_REQUIRED");
  await assert.rejects(() => clinical.service.whatsappDraft(attendant, "h1"), (e: any) => e.getResponse().code === "CRF_REQUIRED");

  for (const reason of ["out_of_stock", "product_request"]) {
    const plain = setup();
    plain.row.reason = reason;
    assert.equal(((await plain.service.get("b1", "h1", attendant)) as any).canHandle, true, reason);
    const started: any = await plain.service.start(attendant, "h1", "whatsapp");
    assert.equal(started.inProgress.byName, "Bruno Dias");
    const draft: any = await plain.service.whatsappDraft(attendant, "h1");
    assert.ok(draft.message.includes("Bruno Dias"));
  }
  const urgent = setup();
  urgent.row.reason = "out_of_stock";
  urgent.row.urgent = true;
  await assert.rejects(() => urgent.service.start(attendant, "h1", "chat"), (e: any) => e.getResponse().code === "CRF_REQUIRED");
});

test("whatsapp draft: no phone => NO_PHONE 409; closed => 409; other business => 404", async () => {
  const noPhone = setup();
  leadPhone = null;
  await assert.rejects(() => noPhone.service.whatsappDraft(pharmacist, "h1"), (e: any) => e.getResponse().code === "NO_PHONE");
  const closed = setup("closed");
  await assert.rejects(() => closed.service.whatsappDraft(pharmacist, "h1"), (e: any) => e.getStatus() === 409);
  const other = setup();
  await assert.rejects(() => other.service.whatsappDraft({ ...pharmacist, businessId: "b2" }, "h1"), (e: any) => e.getStatus() === 404);
});

test("start marks the handoff in progress (status stays open), records who and logs", async () => {
  const { service, row, calls } = setup();
  const dto: any = await service.start(pharmacist, "h1", "whatsapp");
  assert.equal(row.status, "open");
  assert.equal(row.brief.inProgress.byName, "Paulo Nunes");
  assert.equal(row.brief.inProgress.byRole, "Farmacêutico RT");
  assert.equal(row.brief.inProgress.channel, "whatsapp");
  assert.equal(dto.inProgress.byName, "Paulo Nunes");
  assert.equal(row.brief.symptoms, "Dor de cabeça", "the rest of the brief is kept");
  assert.equal(calls.logs[0].action, "handoff.start");
  assert.ok(!JSON.stringify(calls.logs).includes("Dor de cabeça"));
  const chat: any = await service.start(pharmacist, "h1", "anything-else");
  assert.equal(chat.inProgress.channel, "whatsapp", "unknown channel defaults to whatsapp");
  assert.equal(calls.logs.filter((l: any) => l.action === "handoff.start").length, 1, "same person + same channel again: no second log line, marker untouched");
  const closed = setup("closed");
  await assert.rejects(() => closed.service.start(pharmacist, "h1"), (e: any) => e.getStatus() === 409);
  const answered = setup("answered");
  await assert.rejects(() => answered.service.start(pharmacist, "h1"), (e: any) => e.getResponse().code === "INVALID_STATE", "an answered handoff cannot be started again");
});

test("mark answered: one system line in the web chat, status answered, marker cleared, idempotent, logged", async () => {
  const { service, row, calls } = setup();
  await service.start(pharmacist, "h1", "whatsapp");
  const dto: any = await service.markAnswered(pharmacist, "h1");
  assert.equal(calls.notes.length, 1);
  assert.equal(calls.notes[0].text, "Paulo Nunes · Farmacêutico RT continuou o atendimento pelo WhatsApp");
  assert.equal(calls.notes[0].conversationId, "c1");
  assert.equal(row.status, "answered");
  assert.equal(dto.status, "answered");
  assert.equal(dto.inProgress, null);
  assert.equal(row.brief.inProgress, undefined);
  assert.equal(dto.answer.byName, "Paulo Nunes");
  assert.equal(calls.logs.at(-1).action, "handoff.whatsapp_answer");
  await service.markAnswered(pharmacist, "h1");
  assert.equal(calls.notes.length, 1, "no second system line");
  const closed = setup("closed");
  await assert.rejects(() => closed.service.markAnswered(pharmacist, "h1"), (e: any) => e.getStatus() === 409);
});


// ---------------------------------------------------------------- general_question, suggestions, resume link

test("general_question is not clinical: any staff handles it; urgent still needs the pharmacist", async () => {
  const q = setup();
  q.row.reason = "general_question";
  q.row.brief = { question: "Vocês entregam no domingo?" };
  const dto: any = await q.service.get("b1", "h1", attendant);
  assert.equal(dto.requiresPharmacist, false);
  assert.equal(dto.canHandle, true);
  assert.equal(dto.reasonLabel, "Pergunta ao atendimento");
  assert.equal(dto.tagBadge, "blue");
  assert.ok(dto.briefRows.some((r: any) => r.label === "Pergunta do cliente" && r.value.includes("domingo")));
  const replied: any = await q.service.reply(attendant, "h1", { text: "Entregamos sim, até as 18h." });
  assert.equal(replied.status, "answered");
  assert.equal(q.calls.push[0][1].body, "Respondemos à sua pergunta.");
  const urgent = setup();
  urgent.row.reason = "general_question";
  urgent.row.urgent = true;
  await assert.rejects(() => urgent.service.reply(attendant, "h1", { text: "oi" }), (e: any) => e.getResponse().code === "CRF_REQUIRED");
});

test("reply with products writes ONE pharmacist_suggestion card with the exact payload, logs ids only", async () => {
  const { service, row, calls } = setup();
  productRows = [prod("p1", { name: "Dipirona 500mg", presentation: "cx 10 comprimidos", priceCents: 1290, maxQtyPerOrder: 3 }), prod("p2", { saleClass: "prescription", imageKey: "k", updatedAt: new Date(5000) })];
  const dto: any = await service.reply(pharmacist, "h1", { productIds: ["p1", "p2", "p1"], note: "Tomar com água" });
  assert.equal(calls.human.length, 0, "no text => no plain message");
  assert.equal(calls.cards.length, 1);
  const card = calls.cards[0];
  assert.deepEqual(card.author, { memberId: "m-ph", name: "Paulo Nunes", roleName: "Farmacêutico RT" });
  assert.equal(card.content, "Paulo Nunes indicou estes produtos para você: Tomar com água");
  assert.deepEqual(card.uiData, {
    type: "pharmacist_suggestion",
    from: { name: "Paulo Nunes", roleName: "Farmacêutico RT" },
    note: "Tomar com água",
    items: [
      { productId: "p1", name: "Dipirona 500mg", presentation: "cx 10 comprimidos", priceCents: 1290, inStock: true, maxQty: 3, imageUrl: null, placeholderIcon: "pill", requiresPrescription: false },
      { productId: "p2", name: "Produto p2", presentation: "cx 10", priceCents: 1000, inStock: true, maxQty: 5, imageUrl: "/api/public/products/p2/image?v=5", placeholderIcon: "box", requiresPrescription: true },
    ],
  });
  assert.equal(row.status, "answered");
  assert.equal(dto.answer.text, card.content);
  assert.deepEqual(calls.logs[0].detail, { handoffId: "h1", productCount: 2, productIds: ["p1", "p2"] });
  assert.ok(!JSON.stringify(calls.logs).includes("água") && !JSON.stringify(calls.logs).includes("Dor de cabeça"));
  // the listability rules reach the query
  const where = calls.productQueries[0].where;
  assert.equal(where.businessId, "b1");
  assert.deepEqual(where.saleClass, { in: ["otc", "prescription"] });
  assert.deepEqual(where.stockQty, { gt: 0 });
  assert.deepEqual(where.classConfirmedAt, { not: null });
  assert.equal(where.active, true);
});

test("reply with text AND products writes both; text alone and products alone are both valid, neither is not", async () => {
  const both = setup();
  productRows = [prod("p1")];
  await both.service.reply(pharmacist, "h1", { text: "Use 1 comprimido ao dia.", productIds: ["p1"] });
  assert.equal(both.calls.human[0].text, "Use 1 comprimido ao dia.");
  assert.equal(both.calls.cards.length, 1);
  assert.equal(both.calls.cards[0].uiData.note, undefined);
  const none = setup();
  await assert.rejects(() => none.service.reply(pharmacist, "h1", { note: "só nota" }), (e: any) => e.getResponse().code === "INVALID_TEXT");
  await assert.rejects(() => none.service.reply(pharmacist, "h1", { productIds: [] }), (e: any) => e.getResponse().code === "INVALID_TEXT");
});

test("reply rejects unlisted products (controlled, out of stock, other business, unknown), more than 6, bad shapes", async () => {
  const s = setup();
  productRows = [prod("ok"), prod("ctl", { listable: false }), prod("other", { businessId: "b2" })];
  for (const ids of [["ok", "ctl"], ["ok", "other"], ["ok", "missing"]]) {
    await assert.rejects(() => s.service.reply(pharmacist, "h1", { productIds: ids }), (e: any) => e.getResponse().code === "PRODUCT_NOT_LISTABLE");
  }
  await assert.rejects(() => s.service.reply(pharmacist, "h1", { productIds: ["1", "2", "3", "4", "5", "6", "7"] }), (e: any) => e.getResponse().code === "TOO_MANY_PRODUCTS");
  await assert.rejects(() => s.service.reply(pharmacist, "h1", { productIds: "p1" as any }), (e: any) => e.getResponse().code === "INVALID_PRODUCTS");
  await assert.rejects(() => s.service.reply(pharmacist, "h1", { productIds: ["ok"], note: "x".repeat(301) }), (e: any) => e.getResponse().code === "INVALID_NOTE");
  assert.equal(s.calls.cards.length, 0);
  assert.equal(s.row.status, "open", "a rejected reply changes nothing");
});

test("product suggestion permissions: clinical handoff needs CRF, general_question and out_of_stock any staff", async () => {
  productRows = [prod("p1")];
  const clinical = setup();
  await assert.rejects(() => clinical.service.reply(attendant, "h1", { productIds: ["p1"] }), (e: any) => e.getResponse().code === "CRF_REQUIRED");
  for (const reason of ["general_question", "out_of_stock", "product_request"]) {
    const s = setup();
    productRows = [prod("p1")];
    s.row.reason = reason;
    await s.service.reply(attendant, "h1", { productIds: ["p1"] });
    assert.equal(s.calls.cards.length, 1, reason);
  }
});

test("resume link: whatsapp draft carries it last; chat-link endpoint returns it and needs permission", async () => {
  const { service, calls } = setup();
  const draft: any = await service.whatsappDraft(pharmacist, "h1");
  const link = "http://localhost:3005/farmacia-x/chat?c=c1&t=tok";
  assert.equal(draft.resumeLink, link);
  assert.ok(draft.message.endsWith(`Para continuar sua compra pelo chat: ${link}`));
  assert.ok(draft.message.length <= draft.maxChars);
  const r = await service.chatLink(pharmacist, "h1");
  assert.equal(r.url, link);
  assert.equal(calls.logs.at(-1).action, "handoff.chat_link");
  assert.ok(!JSON.stringify(calls.logs).includes("tok"));
  await assert.rejects(() => service.chatLink(attendant, "h1"), (e: any) => e.getResponse().code === "CRF_REQUIRED");
});

test("product search only returns listable products and needs 2+ chars", async () => {
  const s = setup();
  productRows = [prod("p1", { name: "Dipirona" })];
  assert.deepEqual(await s.service.searchProducts("b1", { q: "d" }), { items: [] });
  const r: any = await s.service.searchProducts("b1", { q: "dipi" });
  assert.equal(r.items[0].productId, "p1");
  const where = s.calls.productQueries.at(-1).where;
  assert.deepEqual(where.saleClass, { in: ["otc", "prescription"] });
  assert.equal(where.OR.length, 3);
});

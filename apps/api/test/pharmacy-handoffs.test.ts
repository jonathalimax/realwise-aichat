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

let leadPhone: string | null = "+5541991112233";
function setup(status: "open" | "answered" | "closed" = "open") {
  leadPhone = "+5541991112233";
  const row: any = {
    id: "h1", businessId: "b1", conversationId: "c1", leadId: "l1", reason: "symptom", urgent: false, summary: "Dor de cabeça · há 3 dias",
    brief: { symptoms: "Dor de cabeça", allergies: ["dipirona"], suggestedProducts: [] }, status, answerText: null, answeredAt: null, answeredByName: null, answeredByRole: null,
    createdAt: new Date(Date.now() - 4 * 60000),
  };
  const calls: any = { human: [], push: [], logs: [], notes: [] };
  const prisma: any = {
    client: {
      $executeRaw: async () => 0,
      pharmacistHandoff: {
        findFirst: async ({ where }: any) => (where.id === row.id && where.businessId === row.businessId ? { ...row } : null),
        update: async ({ data }: any) => Object.assign(row, data),
      },
      lead: {
        findMany: async () => [{ id: "l1", name: "Maria Souza", phone: leadPhone }],
        findFirst: async ({ where }: any) => (where.id === "l1" && where.businessId === "b1" ? { phone: leadPhone, phoneNormalized: leadPhone } : null),
      },
      business: { findFirst: async () => ({ name: "Farmácia X" }) },
      product: { findMany: async () => [] },
      conversation: { findFirst: async () => ({ id: "c1", resumeToken: "tok", lastVisitorSeenAt: null, business: { slug: "farmacia-x", name: "Farmácia X" } }) },
    },
  };
  const service = new HandoffsService(
    prisma,
    { record: async (e: any) => calls.logs.push(e) } as any,
    { sendToConversation: async (...a: any[]) => calls.push.push(a) } as any,
    { recordHumanReply: async (i: any) => calls.human.push(i), recordSystemNote: async (i: any) => calls.notes.push(i) } as any,
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
  assert.match(payload.url, /farmacia-x\?c=c1&t=tok$/);
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

test("the detail GET never carries the full phone, only first name + masked number", async () => {
  const { service } = setup();
  const dto: any = await service.get("b1", "h1");
  assert.deepEqual(dto.contact, { firstName: "Maria", phoneMasked: "(41) •••••-2233", hasPhone: true });
  assert.ok(!JSON.stringify(dto).includes("991112233"));
  const list: any = await service.list("b1", {}).catch(() => null);
  if (list) assert.ok(!JSON.stringify(list).includes("991112233"));
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
  const closed = setup("closed");
  await assert.rejects(() => closed.service.start(pharmacist, "h1"), (e: any) => e.getStatus() === 409);
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

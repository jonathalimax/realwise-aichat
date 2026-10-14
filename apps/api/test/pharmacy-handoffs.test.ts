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

function setup(status: "open" | "answered" | "closed" = "open") {
  const row: any = {
    id: "h1", businessId: "b1", conversationId: "c1", leadId: "l1", reason: "symptom", urgent: false, summary: "Dor de cabeça · há 3 dias",
    brief: { symptoms: "Dor de cabeça", allergies: ["dipirona"], suggestedProducts: [] }, status, answerText: null, answeredAt: null, answeredByName: null, answeredByRole: null,
    createdAt: new Date(Date.now() - 4 * 60000),
  };
  const calls: any = { human: [], push: [], logs: [] };
  const prisma: any = {
    client: {
      $executeRaw: async () => 0,
      pharmacistHandoff: {
        findFirst: async ({ where }: any) => (where.id === row.id && where.businessId === row.businessId ? { ...row } : null),
        update: async ({ data }: any) => Object.assign(row, data),
      },
      lead: { findMany: async () => [{ id: "l1", name: "Maria Souza" }] },
      product: { findMany: async () => [] },
      conversation: { findFirst: async () => ({ id: "c1", resumeToken: "tok", lastVisitorSeenAt: null, business: { slug: "farmacia-x", name: "Farmácia X" } }) },
    },
  };
  const service = new HandoffsService(
    prisma,
    { record: async (e: any) => calls.logs.push(e) } as any,
    { sendToConversation: async (...a: any[]) => calls.push.push(a) } as any,
    { recordHumanReply: async (i: any) => calls.human.push(i) } as any,
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

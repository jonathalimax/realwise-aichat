import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewQuestion } from "../src/modules/handoffs/reopen-rules";
import { hasValidPushKeys, isAllowedPushEndpoint } from "../src/modules/push/push.service";

test("answered handoff: buy intent, cart taps and thanks never re-open it", () => {
  for (const t of ["quero comprar", "Quero esse", "vou querer o primeiro", "adicionar ao carrinho", "finalizar pedido", "obrigada", "Obrigado!", "ok", "valeu", "pode ser", "retirada na loja", "usar sugestão"]) assert.equal(isNewQuestion(t), false, t);
});

test("answered handoff: a new symptom or question re-opens it", () => {
  for (const t of ["agora estou com febre desde ontem", "posso tomar junto com ibuprofeno?", "dor?", "tosse seca há 4 dias sem febre"]) assert.equal(isNewQuestion(t), true, t);
});

test("push: only well-formed subscription keys and allowed endpoints", () => {
  const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
  const auth = Buffer.alloc(16, 3).toString("base64url");
  assert.equal(hasValidPushKeys({ p256dh, auth }), true);
  assert.equal(hasValidPushKeys({ p256dh: "x", auth: "y" }), false);
  assert.equal(hasValidPushKeys(undefined), false);
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/x"), false);
  assert.equal(isAllowedPushEndpoint("https://evil.example.com/x"), false);
});

// ---------------------------------------------------------------- catalog: inactive hidden, search not hijacked by digits
import { ProductsService } from "../src/modules/products/products.service";
import { ClassReviewService } from "../src/modules/products/class-review.service";
import { CustomersAdminService } from "../src/modules/customers/customers-admin.service";
import { PrescriptionsService } from "../src/modules/prescriptions/prescriptions.service";
import { OrdersService } from "../src/modules/orders/orders.service";

function recorder() {
  const calls: Array<{ model: string; op: string; args: any }> = [];
  const model = (name: string) =>
    new Proxy({}, { get: (_t, op: string) => async (args: any) => (calls.push({ model: name, op, args }), op === "count" ? 0 : op === "groupBy" || op === "findMany" ? [] : null) });
  const client = new Proxy({}, { get: (_t, name: string) => model(name) });
  return { calls, prisma: { client } as any };
}
const whereOf = (calls: any[], model: string, op: string) => calls.filter((c) => c.model === model && c.op === op).map((c) => c.args?.where);

test("catalog list hides inactive products by default; Inativos and all are explicit", async () => {
  const r = recorder();
  const svc = new ProductsService(r.prisma, { record: async () => {} } as any);
  await svc.list("b1", {});
  assert.equal(whereOf(r.calls, "product", "findMany")[0].active, true);
  assert.ok(whereOf(r.calls, "product", "count").some((w) => w.active === false), "inactive count exists");
  assert.ok(whereOf(r.calls, "product", "groupBy").every((w) => w.active === true), "tab counts only describe active products");
  r.calls.length = 0;
  await svc.list("b1", { active: "false" });
  assert.equal(whereOf(r.calls, "product", "findMany")[0].active, false);
  r.calls.length = 0;
  await svc.list("b1", { active: "all" });
  assert.equal("active" in whereOf(r.calls, "product", "findMany")[0], false);
});

test("catalog search: digits inside a name never become an EAN search; a numeric query still does", async () => {
  const r = recorder();
  const svc = new ProductsService(r.prisma, { record: async () => {} } as any);
  await svc.list("b1", { q: "ibuprofeno 400" });
  assert.equal(JSON.stringify(whereOf(r.calls, "product", "findMany")[0]).includes('"ean"'), false);
  r.calls.length = 0;
  await svc.list("b1", { q: "7891000100080" });
  assert.equal(JSON.stringify(whereOf(r.calls, "product", "findMany")[0]).includes('"ean"'), true);
});

test("class review only counts active products and 'Confirmar todos' only offers never-confirmed ones", async () => {
  const r = recorder();
  await new ClassReviewService(r.prisma, { record: async () => {} } as any).overview("b1");
  const wheres = whereOf(r.calls, "product", "count");
  assert.ok(wheres.length > 0 && wheres.every((w) => w.active === true));
  assert.ok(wheres.some((w) => w.classConfirmedAt === null && w.classProposed === "otc"), "bulk-pending count exists");
});

test("customers / orders / prescriptions search: a name with digits is not a phone or number search", async () => {
  const r = recorder();
  await new CustomersAdminService(r.prisma).list("b1", { q: "Ana 123" });
  assert.equal(JSON.stringify(whereOf(r.calls, "lead", "findMany")[0]).includes("phoneNormalized"), false);
  r.calls.length = 0;
  await new CustomersAdminService(r.prisma).list("b1", { q: "(41) 98888-0081" });
  assert.equal(JSON.stringify(whereOf(r.calls, "lead", "findMany")[0]).includes("phoneNormalized"), true);

  const rx = new PrescriptionsService(r.prisma, {} as any, {} as any, {} as any, {} as any);
  r.calls.length = 0;
  await rx.list({ businessId: "b1", permissions: {} } as any, { q: "Maria 2" });
  assert.equal(JSON.stringify(whereOf(r.calls, "prescriptionUpload", "findMany")[0]).includes('"number"'), false);
  r.calls.length = 0;
  await rx.list({ businessId: "b1", permissions: {} } as any, { q: "RX-12" });
  assert.equal(JSON.stringify(whereOf(r.calls, "prescriptionUpload", "findMany")[0]).includes('"number":12'), true);
  r.calls.length = 0;
  await rx.list({ businessId: "b1", permissions: {} } as any, { q: "41999998888" });
  assert.equal(JSON.stringify(whereOf(r.calls, "prescriptionUpload", "findMany")[0]).includes('"number"'), false, "an 11-digit phone cannot overflow the Int column");

  const settings = { getRow: async () => ({ stockMaxAgeHours: 24 }) } as any;
  const orders = new OrdersService(r.prisma, {} as any, {} as any, settings, {} as any);
  r.calls.length = 0;
  await orders.list({ businessId: "b1" } as any, { q: "João 1001" });
  assert.equal(JSON.stringify(whereOf(r.calls, "order", "findMany")[0]).includes('"phone"'), false);
});

// ---------------------------------------------------------------- billing: never leak the payment provider's message
import { BillingService } from "../src/modules/billing/billing.service";

test("billing portal / checkout failures show a generic message, not the provider's text", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  const prisma = {
    client: {
      subscription: { findUnique: async () => ({ stripeCustomerId: "cus_x", status: "canceled" }) },
      business: { findUnique: async () => ({ id: "b1" }) },
      plan: { findUnique: async () => ({ code: "profissional", isActive: true }) },
    },
  } as any;
  const svc = new BillingService(prisma);
  const boom = Object.assign(new Error("Invalid API Key provided: sk_test_*****secret"), {});
  (svc as any).stripe = { billingPortal: { sessions: { create: async () => { throw boom; } } }, checkout: { sessions: { create: async () => { throw boom; } } } };
  await assert.rejects(() => svc.createPortalSession("b1"), (e: any) => !/sk_test|Invalid API Key/.test(JSON.stringify(e.getResponse())) && /portal de cobrança/.test(e.message));
  process.env.STRIPE_PRICE_PROFISSIONAL = "price_x";
  await assert.rejects(() => svc.createCheckoutSession("b1", "profissional"), (e: any) => e.getStatus() === 400 && !/sk_test|Invalid API Key/.test(JSON.stringify(e.getResponse())));
});

// ---------------------------------------------------------------- dashboard numbers agree; rx approval tells the customer
import { PharmacyDashboardService } from "../src/modules/pharmacy-dashboard/pharmacy-dashboard.service";

test("Início funnel counts orders the same way Análises does (canceled and rejected excluded)", async () => {
  const r = recorder();
  await (new PharmacyDashboardService(r.prisma, {} as any, {} as any) as any).funnel("b1", new Date());
  const w = whereOf(r.calls, "order", "count")[0];
  assert.deepEqual(w.status, { notIn: ["canceled", "rejected"] });
});

test("approving a prescription posts a system message in the customer's conversation", async () => {
  const created: any[] = [];
  const rxRow = { id: "r1", businessId: "b1", number: 7, status: "pending", orderId: "o1", conversationId: "c1", order: { code: "PED-1" }, prescriptionsExtra: null };
  const prisma = {
    client: {
      prescriptionUpload: { findFirst: async () => rxRow, updateMany: async () => ({ count: 1 }) },
      conversation: { findFirst: async () => ({ id: "c1" }), update: async () => ({}) },
      message: { create: async (a: any) => (created.push(a.data), {}) },
    },
  } as any;
  const svc = new PrescriptionsService(prisma, { record: async () => {} } as any, {} as any, {} as any, {} as any);
  (svc as any).get = async () => ({ ok: true });
  await svc.approve({ businessId: "b1", memberId: "m1", name: "Dra" } as any, "r1");
  assert.equal(created.length, 1);
  assert.equal(created[0].role, "system");
  assert.match(created[0].content, /RX-7 foi aprovada.*PED-1/);
});

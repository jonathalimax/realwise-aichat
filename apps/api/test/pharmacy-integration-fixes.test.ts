import "./support/pharmacy-env";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { resolveUploadOwner } from "../src/modules/prescriptions/upload-owner";
import { OrdersService } from "../src/modules/orders/orders.service";

// ---- prescription upload ownership (photo may arrive before the phone number)

const conv = { id: "c1", leadId: null as string | null, visitorToken: "anon-1" };

test("anonymous visitor that owns the conversation may upload (lead stays null)", () => {
  assert.deepEqual(resolveUploadOwner("b1", { visitorToken: "anon-1" }, conv), { ok: true, leadId: null });
});

test("upload uses the conversation's lead once checkout identified the customer", () => {
  assert.deepEqual(resolveUploadOwner("b1", { visitorToken: "anon-1" }, { ...conv, leadId: "lead-9" }), { ok: true, leadId: "lead-9" });
});

test("identified visitor owns through the lead id", () => {
  assert.deepEqual(resolveUploadOwner("b1", { businessId: "b1", leadId: "lead-9", visitorToken: "other" }, { ...conv, leadId: "lead-9" }), { ok: true, leadId: "lead-9" });
});

test("a visitor that does not own the conversation, another tenant's session or no session are refused", () => {
  assert.equal(resolveUploadOwner("b1", { visitorToken: "someone-else" }, conv).ok, false);
  assert.equal(resolveUploadOwner("b1", { businessId: "b2", leadId: "lead-9" }, { ...conv, leadId: "lead-9" }).ok, false);
  assert.equal(resolveUploadOwner("b1", {}, conv).ok, false);
  assert.equal(resolveUploadOwner("b1", { visitorToken: "anon-1" }, null).ok, false);
});

// ---- minimum order applies to delivery only (the chat copy says "Pedido mínimo para entrega")

function serviceWithMinimum() {
  const product = {
    id: "p1", businessId: "b1", name: "Paracetamol 750mg", presentation: "20 comprimidos", priceCents: 1590, stockQty: 50, stockAsOf: new Date(),
    saleClass: "otc", classConfirmedAt: new Date(), pharmacistRequired: false, active: true, maxQtyPerOrder: null, deletedAt: null,
  };
  const prisma = {
    client: {
      lead: { findFirst: async () => ({ id: "l1" }) },
      product: { findMany: async () => [product] },
      prescriptionUpload: { findMany: async () => [] },
      $transaction: async () => {
        throw new Error("REACHED_TRANSACTION");
      },
    },
  };
  const settings = {
    getRow: async () => ({ minOrderCents: 2500, deliveryEnabled: true, pickupEnabled: true, autoConfirmEnabled: true, stockMaxAgeHours: 24, maxQtyPerItemDefault: 5, deliveryAreas: [] }),
  };
  return new OrdersService(prisma as any, {} as any, {} as any, settings as any, { differsFromSavedDefault: async () => false } as any);
}

const base = { businessId: "b1", leadId: "l1", conversationId: "c1", items: [{ productId: "p1", qty: 1 }] };
const address = { cep: "80620010", street: "Rua A", number: "1", district: "Centro", city: "Curitiba", state: "PR" };

test("order below the minimum is refused for delivery", async () => {
  await assert.rejects(() => serviceWithMinimum().createFromCart({ ...base, fulfillment: "delivery", address } as any), (e: any) => e?.getResponse?.().code === "ORDER_BELOW_MINIMUM");
});

test("order below the minimum is accepted for pickup", async () => {
  await assert.rejects(() => serviceWithMinimum().createFromCart({ ...base, fulfillment: "pickup" } as any), /REACHED_TRANSACTION/);
});

after(() => {
  setTimeout(() => process.exit(0), 200);
});

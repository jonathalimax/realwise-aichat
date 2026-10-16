import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_ACTIONS,
  allowedActions,
  evaluateTransition,
  isClosed,
  machineActions,
  nextStatus,
  type OrderAction,
} from "../src/modules/orders/order-state";
import { addressInsideAreas, autoConfirmDecision, canEnterCart, type CartProductLike } from "../src/modules/orders/auto-confirm";
import { orderDetailDto, orderListDto, publicOrderDto, rxPendingOf, staffAddressLabel, staleAtOrderTime, type OrderRow } from "../src/modules/orders/order-dto";
import { ORDER_TAB_STATUSES, orderTab, type OrderStatus } from "../src/modules/pharmacy-common/labels";
import { sheetAgeLabel, sheetStatus } from "../src/modules/pharmacy-common/sheet";
import { formatBRL, formatBRLShort, formatPhoneBr } from "../src/modules/pharmacy-common/format";
import { OrdersService } from "../src/modules/orders/orders.service";

const STATUSES: OrderStatus[] = ["pending_pharmacist", "confirmed", "out_for_delivery", "ready_for_pickup", "delivered", "canceled", "rejected"];

// ---------------------------------------------------------------- status machine

test("status machine: every (status, action, fulfillment) combination matches API.md 2.1", () => {
  const expected: Record<string, OrderStatus> = {
    "pending_pharmacist|confirm|delivery": "confirmed",
    "pending_pharmacist|confirm|pickup": "confirmed",
    "confirmed|out|delivery": "out_for_delivery",
    "confirmed|out|pickup": "ready_for_pickup",
    "out_for_delivery|done|delivery": "delivered",
    "ready_for_pickup|done|pickup": "delivered",
    "out_for_delivery|done|pickup": "delivered",
    "ready_for_pickup|done|delivery": "delivered",
    "pending_pharmacist|cancel|delivery": "canceled",
    "pending_pharmacist|cancel|pickup": "canceled",
    "confirmed|cancel|delivery": "canceled",
    "confirmed|cancel|pickup": "canceled",
  };
  for (const from of STATUSES) {
    for (const action of ORDER_ACTIONS) {
      for (const f of ["delivery", "pickup"] as const) {
        const want = expected[`${from}|${action}|${f}`] ?? null;
        assert.equal(nextStatus(from, action, f), want, `${from} --${action}--> (${f})`);
      }
    }
  }
});

test("terminal statuses allow nothing; machineActions per state", () => {
  for (const s of ["delivered", "canceled", "rejected"] as const) {
    assert.equal(isClosed(s), true);
    assert.deepEqual(machineActions(s, "delivery"), []);
  }
  assert.deepEqual(machineActions("pending_pharmacist", "delivery"), ["confirm", "cancel"]);
  assert.deepEqual(machineActions("confirmed", "pickup"), ["out", "cancel"]);
  assert.deepEqual(machineActions("out_for_delivery", "delivery"), ["done"]);
  assert.equal(isClosed("confirmed"), false);
});

const base = { fulfillment: "delivery" as const, rxPending: false, courierMemberId: null };
const staff = { memberId: "m1", ownDeliveriesOnly: false };
const courier = { memberId: "c1", ownDeliveriesOnly: true };

test("confirm is blocked while a prescription is pending or rejected (RX_PENDING)", () => {
  const v = evaluateTransition({ ...base, status: "pending_pharmacist", rxPending: true }, "confirm", staff);
  assert.deepEqual(v, { ok: false, code: "RX_PENDING" });
  assert.ok(allowedActions({ ...base, status: "pending_pharmacist", rxPending: true }, staff).includes("cancel"));
  assert.ok(!allowedActions({ ...base, status: "pending_pharmacist", rxPending: true }, staff).includes("confirm"));
  assert.deepEqual(evaluateTransition({ ...base, status: "pending_pharmacist" }, "confirm", staff), { ok: true, to: "confirmed" });
});

test("invalid transition reports from / allowed", () => {
  const v = evaluateTransition({ ...base, status: "confirmed" }, "done", staff);
  assert.equal(v.ok, false);
  if (!v.ok && v.code === "INVALID_TRANSITION") assert.deepEqual(v.allowed, ["out", "cancel"]);
  else assert.fail("expected INVALID_TRANSITION");
  assert.equal(evaluateTransition({ ...base, status: "delivered" }, "cancel", staff).ok, false);
});

test("courier: only own orders and only out / done", () => {
  const own = { ...base, status: "out_for_delivery" as const, courierMemberId: "c1" };
  assert.deepEqual(evaluateTransition(own, "done", courier), { ok: true, to: "delivered" });
  assert.deepEqual(evaluateTransition({ ...own, courierMemberId: "someone-else" }, "done", courier), { ok: false, code: "OWN_DELIVERIES_ONLY" });
  assert.deepEqual(evaluateTransition({ ...own, courierMemberId: null }, "done", courier), { ok: false, code: "OWN_DELIVERIES_ONLY" });
  const confirmed = { ...base, status: "confirmed" as const, courierMemberId: "c1" };
  assert.deepEqual(evaluateTransition(confirmed, "out", courier), { ok: true, to: "out_for_delivery" });
  assert.deepEqual(evaluateTransition(confirmed, "cancel", courier), { ok: false, code: "COURIER_ACTION_DENIED" });
  assert.deepEqual(allowedActions(confirmed, courier), ["out"]);
  assert.deepEqual(allowedActions({ ...confirmed, courierMemberId: "x" }, courier), []);
});

test("order tabs map statuses exactly as API.md 2", () => {
  assert.deepEqual(ORDER_TAB_STATUSES.out, ["out_for_delivery", "ready_for_pickup"]);
  assert.deepEqual(ORDER_TAB_STATUSES.canceled, ["canceled", "rejected"]);
  assert.equal(orderTab("pending_pharmacist"), "new");
  assert.equal(orderTab("ready_for_pickup"), "out");
  assert.equal(orderTab("rejected"), "canceled");
  assert.equal(orderTab("delivered"), "done");
});

// ---------------------------------------------------------------- canEnterCart / auto-confirm

const otc: CartProductLike = { saleClass: "otc", classConfirmedAt: new Date(), pharmacistRequired: false, active: true, stockQty: 10, maxQtyPerOrder: 5 };

test("canEnterCart: controlled and unclassified NEVER enter, in any state", () => {
  for (const hasRx of [true, false]) {
    for (const stockQty of [0, 5, 1000]) {
      assert.deepEqual(canEnterCart({ ...otc, saleClass: "controlled", stockQty }, 1, { hasPrescriptionUpload: hasRx }), { ok: false, reason: "controlled" });
      assert.deepEqual(canEnterCart({ ...otc, saleClass: "unclassified", classConfirmedAt: null, stockQty }, 1, { hasPrescriptionUpload: hasRx }), { ok: false, reason: "unclassified" });
    }
  }
  // even a "confirmed" controlled product
  assert.equal(canEnterCart({ ...otc, saleClass: "controlled" }, 1, { hasPrescriptionUpload: true }).ok, false);
});

test("canEnterCart: otc rules (confirmed, flag, stock, limits) and prescription only with an upload", () => {
  const ctx = { hasPrescriptionUpload: false };
  assert.deepEqual(canEnterCart(otc, 2, ctx), { ok: true });
  assert.deepEqual(canEnterCart({ ...otc, classConfirmedAt: null }, 1, ctx), { ok: false, reason: "class_unconfirmed" });
  assert.deepEqual(canEnterCart({ ...otc, pharmacistRequired: true }, 1, ctx), { ok: false, reason: "pharmacist_required" });
  assert.deepEqual(canEnterCart({ ...otc, stockQty: 1 }, 2, ctx), { ok: false, reason: "out_of_stock" });
  assert.deepEqual(canEnterCart({ ...otc, stockQty: null }, 1, ctx), { ok: false, reason: "out_of_stock" });
  assert.deepEqual(canEnterCart(otc, 6, ctx), { ok: false, reason: "qty_over_limit", maxQty: 5 });
  assert.deepEqual(canEnterCart({ ...otc, maxQtyPerOrder: null }, 4, { ...ctx, maxQtyDefault: 3 }), { ok: false, reason: "qty_over_limit", maxQty: 3 });
  assert.deepEqual(canEnterCart({ ...otc, active: false }, 1, ctx), { ok: false, reason: "inactive" });
  assert.deepEqual(canEnterCart(otc, 0, ctx), { ok: false, reason: "invalid_qty" });
  assert.deepEqual(canEnterCart(otc, 1.5, ctx), { ok: false, reason: "invalid_qty" });
  const rx = { ...otc, saleClass: "prescription" as const };
  assert.deepEqual(canEnterCart(rx, 1, ctx), { ok: false, reason: "prescription_required" });
  assert.deepEqual(canEnterCart(rx, 1, { hasPrescriptionUpload: true }), { ok: true });
});

const areas = [{ type: "district" as const, value: "Água Verde" }, { type: "cep_prefix" as const, value: "80250" }];
const autoBase = {
  autoConfirmEnabled: true,
  stockMaxAgeHours: 24,
  maxQtyDefault: null,
  deliveryAreas: areas,
  fulfillment: "delivery" as const,
  address: { district: "agua verde", cep: "80010000" },
  hasPrescription: false,
  sheetAsOf: new Date(Date.now() - 3600_000),
  items: [{ ...otc, qty: 2 }],
};

test("autoConfirmDecision: auto only when every rule holds", () => {
  assert.deepEqual(autoConfirmDecision(autoBase), { auto: true, reasons: [] });
  assert.deepEqual(autoConfirmDecision({ ...autoBase, fulfillment: "pickup", address: null }), { auto: true, reasons: [] });
});

test("autoConfirmDecision: each failing rule keeps the order for the pharmacist", () => {
  const why = (patch: Partial<typeof autoBase>) => autoConfirmDecision({ ...autoBase, ...patch });
  assert.ok(why({ autoConfirmEnabled: false }).reasons.includes("auto_confirm_disabled"));
  assert.ok(why({ hasPrescription: true }).reasons.includes("prescription"), "Rx orders are NEVER auto-confirmed");
  assert.ok(why({ sheetAsOf: new Date(Date.now() - 25 * 3600_000) }).reasons.includes("stale_sheet"));
  assert.ok(why({ sheetAsOf: null }).reasons.includes("stale_sheet"));
  assert.ok(why({ address: { district: "Batel", cep: "80420000" } }).reasons.includes("outside_area"));
  assert.ok(why({ deliveryAreas: [] }).reasons.includes("outside_area"), "no configured area cannot prove the address is inside");
  assert.ok(why({ items: [{ ...otc, qty: 11 }] }).reasons.includes("stock"));
  assert.ok(why({ items: [{ ...otc, qty: 6 }] }).reasons.includes("qty_limit"));
  assert.ok(why({ items: [{ ...otc, qty: 1, pharmacistRequired: true }] }).reasons.includes("pharmacist_required"));
  assert.ok(why({ items: [{ ...otc, qty: 1, saleClass: "prescription" }] }).reasons.includes("not_confirmed_otc"));
  assert.ok(why({ items: [{ ...otc, qty: 1, classConfirmedAt: null }] }).reasons.includes("not_confirmed_otc"));
  assert.equal(why({ items: [] }).auto, false);
  // pickup ignores the area check
  assert.equal(why({ fulfillment: "pickup", address: null, deliveryAreas: [] }).auto, true);
});

test("addressInsideAreas matches district (accent/case folded) and CEP prefix", () => {
  assert.equal(addressInsideAreas({ district: "ÁGUA VERDE" }, areas), true);
  assert.equal(addressInsideAreas({ district: "Batel", cep: "80250-123" }, areas), true);
  assert.equal(addressInsideAreas({ district: "Batel", cep: "80420000" }, areas), false);
  assert.equal(addressInsideAreas(null, areas), false);
});

// ---------------------------------------------------------------- stale sheet helper

test("stale-sheet logic helper", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const fresh = sheetStatus(new Date(now - 5 * 3600_000), 24, now);
  assert.deepEqual({ age: fresh.ageHours, stale: fresh.stale, fresh: fresh.fresh }, { age: 5, stale: false, fresh: true });
  const edge = sheetStatus(new Date(now - 24 * 3600_000), 24, now);
  assert.equal(edge.stale, false, "exactly at the limit is still fresh");
  const old = sheetStatus(new Date(now - 24 * 3600_000 - 1), 24, now);
  assert.equal(old.stale, true);
  assert.equal(old.fresh, false);
  const none = sheetStatus(null, 24, now);
  assert.deepEqual({ stale: none.stale, fresh: none.fresh, age: none.ageHours }, { stale: false, fresh: false, age: null });
  assert.equal(sheetAgeLabel(5), "Estoque atualizado há 5h");
  assert.equal(sheetAgeLabel(0), "Estoque atualizado há menos de 1h");
  assert.equal(sheetAgeLabel(72), "Estoque atualizado há 3 dias");
  assert.equal(sheetAgeLabel(null), "Estoque ainda não importado");
});

// ---------------------------------------------------------------- DTOs

const lead = { id: "l1", name: "João Silva", phone: "+5541998123344", email: "joao@email.com" };
function row(patch: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o1",
    code: "PED-1001",
    status: "pending_pharmacist",
    fulfillment: "delivery",
    subtotalCents: 890,
    deliveryFeeCents: 600,
    totalCents: 1490,
    paymentMethod: "on_delivery",
    addressSnapshot: { cep: "80250000", street: "Rua das Flores", number: "120B", complement: "ap 31", reference: "portão azul", district: "Água Verde", city: "Curitiba", state: "PR" },
    addressDiffersFromSaved: true,
    notes: null,
    autoConfirmed: false,
    hasPrescription: false,
    stockAsOfSnapshot: new Date("2026-10-13T08:00:00Z"),
    statusReason: null,
    courierMemberId: null,
    conversationId: "c1",
    createdAt: new Date("2026-10-13T12:00:00Z"),
    lead,
    items: [{ id: "i1", productId: "p1", nameSnapshot: "Dipirona 500 mg · 10 comp.", unitPriceCents: 890, qty: 1, saleClassSnapshot: "otc" }],
    prescriptions: [],
    events: [
      { toStatus: "pending_pharmacist", createdAt: new Date("2026-10-13T12:00:00Z"), byName: "Cliente", reason: null },
    ],
    courier: null,
    ...patch,
  };
}

test("order list/detail DTO matches the contract", () => {
  const now = Date.parse("2026-10-13T12:02:00Z");
  const list = orderListDto(row(), 24, now);
  assert.equal(list.kindLabel, "Entrega");
  assert.equal(list.waitingMinutes, 2);
  assert.equal(list.needsAction, true);
  assert.equal(list.statusLabel, "Novo");
  assert.equal(list.statusBadge, "blue");
  assert.equal(list.tab, "new");
  assert.equal(list.originLabel, "Chat");
  assert.equal(orderListDto(row({ autoConfirmed: true, status: "confirmed" }), 24, now).originLabel, "⚡ automático");
  assert.equal(orderListDto(row({ hasPrescription: true }), 24, now).kindLabel, "Receita");
  assert.equal(orderListDto(row({ fulfillment: "pickup" }), 24, now).kindLabel, "Retirada");
  const detail = orderDetailDto(row(), { maxAgeHours: 24, actor: staff, now });
  assert.equal(detail.address?.label, "Rua das Flores, 120B, ap 31 · Água Verde, Curitiba/PR · ref: portão azul");
  assert.equal(detail.customer.phoneFormatted, "(41) 99812-3344");
  assert.deepEqual(detail.allowedActions, ["confirm", "cancel"]);
  assert.equal(detail.actionLabels.out, "Saiu para entrega");
  assert.equal(detail.paymentLabel, "na entrega");
  assert.equal(detail.items[0].lineTotalCents, 890);
  assert.equal(detail.items[0].classLabel, "OTC");
  assert.equal(detail.cancelReasons.length, 4);
  const pickup = orderDetailDto(row({ fulfillment: "pickup", status: "confirmed", addressSnapshot: null }), { maxAgeHours: 24, actor: staff, now });
  assert.equal(pickup.address, null);
  assert.equal(pickup.actionLabels.out, "Pronto para retirada");
  assert.equal(pickup.paymentLabel, "na retirada");
});

test("rxPending / stale-at-order-time", () => {
  assert.equal(rxPendingOf({ prescriptions: [{ id: "r", number: 1, status: "pending" }] }), true);
  assert.equal(rxPendingOf({ prescriptions: [{ id: "r", number: 1, status: "rejected" }] }), true);
  assert.equal(rxPendingOf({ prescriptions: [{ id: "r", number: 1, status: "approved" }] }), false);
  assert.equal(rxPendingOf({ prescriptions: [] }), false);
  const created = new Date("2026-10-13T12:00:00Z");
  assert.equal(staleAtOrderTime({ createdAt: created, stockAsOfSnapshot: new Date("2026-10-12T10:00:00Z") }, 24), true);
  assert.equal(staleAtOrderTime({ createdAt: created, stockAsOfSnapshot: new Date("2026-10-13T08:00:00Z") }, 24), false);
  assert.equal(staleAtOrderTime({ createdAt: created, stockAsOfSnapshot: null }, 24), false);
});

test("courier detail only offers own actions", () => {
  const r = row({ status: "confirmed", courierMemberId: "c1" });
  assert.deepEqual(orderDetailDto(r, { maxAgeHours: 24, actor: courier }).allowedActions, ["out"]);
  assert.deepEqual(orderDetailDto({ ...r, courierMemberId: "zz" }, { maxAgeHours: 24, actor: courier }).allowedActions, []);
});

test("public order page: steps, hidden street number, canceled block, no health data", () => {
  const events = [
    { toStatus: "pending_pharmacist" as const, createdAt: new Date("2026-10-13T12:00:00Z"), byName: "Cliente", reason: null },
    { toStatus: "confirmed" as const, createdAt: new Date("2026-10-13T12:05:00Z"), byName: "Maria", reason: null },
    { toStatus: "out_for_delivery" as const, createdAt: new Date("2026-10-13T12:30:00Z"), byName: "Maria", reason: null },
  ];
  const input = {
    ...row({ status: "out_for_delivery", events }),
    events,
    updatedAt: new Date("2026-10-13T12:30:00Z"),
    canceledAt: null,
    business: { name: "Farmácia Exemplo", logoUrl: null },
    branding: { primaryColor: "#0F766E", secondaryColor: "#0B4F4A", tertiaryColor: "#F59E0B" },
    pharmacyPhone: "+5541999990000",
  };
  const dto = publicOrderDto(input);
  assert.deepEqual(dto.steps.map((s) => [s.key, s.done]), [["received", true], ["confirmed", true], ["out", true], ["delivered", false]]);
  assert.equal(dto.steps[2].label, "Saiu para entrega");
  assert.equal(dto.addressLabel, "Rua das Flores, nº •••, Água Verde");
  assert.ok(!JSON.stringify(dto).includes("120B"), "street number must not leak");
  assert.ok(!JSON.stringify(dto).includes("joao@email.com"));
  assert.equal(dto.canceled, null);
  const pick = publicOrderDto({ ...input, fulfillment: "pickup", status: "ready_for_pickup" });
  assert.equal(pick.steps[2].label, "Pronto para retirada");
  const events2 = [...events.slice(0, 1), { toStatus: "canceled" as const, createdAt: new Date("2026-10-13T12:10:00Z"), byName: "Maria", reason: "Sem estoque" }];
  const canceled = publicOrderDto({ ...input, status: "canceled", statusReason: "Sem estoque", events: events2, canceledAt: new Date("2026-10-13T12:10:00Z") });
  assert.deepEqual(canceled.canceled, { reason: "Sem estoque", at: "2026-10-13T12:10:00.000Z" });
  assert.equal(canceled.steps[1].done, false);
});

test("formatting helpers", () => {
  assert.equal(formatBRL(84260), "R$ 842,60");
  assert.equal(formatBRL(5), "R$ 0,05");
  assert.equal(formatBRL(100000000), "R$ 1.000.000,00");
  assert.equal(formatBRLShort(702000), "R$ 7.020");
  assert.equal(formatBRLShort(702050), "R$ 7.020,50");
  assert.equal(formatPhoneBr("+5541998123344"), "(41) 99812-3344");
  assert.equal(formatPhoneBr(null), null);
  assert.equal(staffAddressLabel({ street: "Rua A", number: "S/N", district: "Centro", city: "Curitiba", state: "PR" }), "Rua A, S/N · Centro, Curitiba/PR");
});

// ---------------------------------------------------------------- service: transition enforcement with a fake DB

function fakeOrdersService(order: any) {
  const calls: any = { updates: [], events: [], logs: [], rxUpdates: [] };
  const prisma: any = {
    client: {
      order: {
        findFirst: async ({ where }: any) => (where.id === order.id && where.businessId === order.businessId ? { ...order } : null),
        updateMany: async ({ where, data }: any) => {
          if (order.status !== where.status) return { count: 0 };
          calls.updates.push(data);
          Object.assign(order, data);
          return { count: 1 };
        },
      },
      orderStatusEvent: { create: async ({ data }: any) => calls.events.push(data) },
      prescriptionUpload: {
        findMany: async () => order.prescriptions.map((p: any) => ({ ...p, createdAt: new Date(), reviewedAt: null, fileDeletedAt: null })),
        update: async ({ data }: any) => calls.rxUpdates.push(data),
      },
    },
  };
  const accessLog: any = { record: async (e: any) => calls.logs.push(e) };
  const notifications: any = { orderHandled: async () => {}, newOrder: async () => {} };
  const settings: any = { getRow: async () => ({ stockMaxAgeHours: 24, prescriptionRetentionDays: 30 }) };
  const service = new OrdersService(prisma, accessLog, notifications, settings, {} as any);
  return { service, calls, order };
}
const member = (patch: any = {}): any => ({ memberId: "m1", businessId: "b1", name: "Maria", roleName: "Atendente", roleKey: "attendant", ownDeliveriesOnly: false, ...patch });
function dbOrder(patch: any = {}) {
  return { ...row(), businessId: "b1", statusToken: "t".repeat(48), ...patch, lead: { ...lead }, events: [] };
}

test("OrdersService.transition: confirm writes event, access log and closes alerts", async () => {
  const { service, calls, order } = fakeOrdersService(dbOrder());
  const dto = await service.transition(member(), "o1", "confirm");
  assert.equal(order.status, "confirmed");
  assert.equal(dto.status, "confirmed");
  assert.deepEqual(calls.events.map((e: any) => [e.fromStatus, e.toStatus, e.byName]), [["pending_pharmacist", "confirmed", "Maria"]]);
  assert.equal(calls.logs[0].action, "order.confirm");
  assert.equal(calls.logs[0].target, "PED-1001");
  assert.ok(calls.updates[0].confirmedAt instanceof Date);
});

test("OrdersService.transition: RX_PENDING 409, cancel needs a reason, other business is 404", async () => {
  const withRx = fakeOrdersService(dbOrder({ prescriptions: [{ id: "r1", number: 1, status: "pending" }] }));
  await assert.rejects(() => withRx.service.transition(member(), "o1", "confirm"), (e: any) => e.getStatus() === 409 && e.getResponse().code === "RX_PENDING");
  const plain = fakeOrdersService(dbOrder());
  await assert.rejects(() => plain.service.transition(member(), "o1", "cancel", {}), (e: any) => e.getStatus() === 400 && e.getResponse().code === "REASON_REQUIRED");
  await assert.rejects(() => plain.service.transition(member(), "o1", "cancel", { reasonCode: "other" }), (e: any) => e.getResponse().code === "NOTE_REQUIRED");
  await assert.rejects(() => plain.service.transition(member({ businessId: "b2" }), "o1", "confirm"), (e: any) => e.getStatus() === 404);
  const done = await plain.service.transition(member(), "o1", "cancel", { reasonCode: "out_of_stock" });
  assert.equal(done.status, "canceled");
  assert.equal(done.statusReason, "Sem estoque");
  assert.equal(plain.calls.logs[0].action, "order.cancel");
});

test("OrdersService.transition: invalid transition is 409 with allowed; courier rules", async () => {
  const { service } = fakeOrdersService(dbOrder({ status: "confirmed" }));
  await assert.rejects(
    () => service.transition(member(), "o1", "done"),
    (e: any) => e.getStatus() === 409 && e.getResponse().code === "INVALID_TRANSITION" && e.getResponse().from === "confirmed" && JSON.stringify(e.getResponse().allowed) === '["out","cancel"]',
  );
  const courierSvc = fakeOrdersService(dbOrder({ status: "out_for_delivery", courierMemberId: "someone-else" }));
  await assert.rejects(() => courierSvc.service.transition(member({ memberId: "c1", ownDeliveriesOnly: true }), "o1", "done"), (e: any) => e.getStatus() === 403 && e.getResponse().code === "OWN_DELIVERIES_ONLY");
  const mine = fakeOrdersService(dbOrder({ status: "out_for_delivery", courierMemberId: "c1" }));
  const res = await mine.service.transition(member({ memberId: "c1", ownDeliveriesOnly: true }), "o1", "done");
  assert.equal(res.status, "delivered");
  assert.ok(mine.calls.updates[0].deliveredAt instanceof Date);
});

test("OrdersService.transition: closing an order starts the prescription retention clock", async () => {
  const { service, calls } = fakeOrdersService(dbOrder({ status: "out_for_delivery", prescriptions: [{ id: "r1", number: 1, status: "approved" }] }));
  await service.transition(member(), "o1", "done");
  assert.equal(calls.rxUpdates.length, 1);
  const days = (calls.rxUpdates[0].retentionDeleteAt.getTime() - Date.now()) / 86400000;
  assert.ok(days > 29 && days < 31, `retention ~30 days, got ${days}`);
});

test("allowedActions is empty for every action on closed orders", () => {
  for (const s of ["delivered", "canceled", "rejected"] as OrderStatus[]) {
    for (const a of ORDER_ACTIONS as readonly OrderAction[]) {
      assert.equal(evaluateTransition({ ...base, status: s }, a, staff).ok, false);
    }
  }
});

test("OrdersService reads: a courier's list, counts and detail are scoped to their own deliveries", async () => {
  const wheres: any[] = [];
  const prisma: any = {
    client: {
      order: {
        findMany: async ({ where }: any) => (wheres.push(["list", where]), []),
        groupBy: async ({ where }: any) => (wheres.push(["counts", where]), []),
        findFirst: async ({ where }: any) => (wheres.push(["detail", where]), null),
      },
    },
  };
  const settings: any = { getRow: async () => ({ stockMaxAgeHours: 24 }) };
  const service = new OrdersService(prisma, {} as any, {} as any, settings, {} as any);
  const courier = member({ memberId: "c1", roleKey: "courier", ownDeliveriesOnly: true });
  await service.list(courier, { q: "PED" });
  await assert.rejects(() => service.get(courier, "someone-elses"), (e: any) => e.getStatus() === 404, "other deliveries look nonexistent");
  for (const [, w] of wheres) assert.equal(w.courierMemberId, "c1");
  assert.equal(wheres.filter(([k]) => k === "counts").length, 1, "counts are scoped too");
  wheres.length = 0;
  await service.list(member(), {});
  for (const [, w] of wheres) assert.equal("courierMemberId" in w, false, "staff is not scoped");
});

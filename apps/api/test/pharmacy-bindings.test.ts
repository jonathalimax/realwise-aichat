import "./support/pharmacy-env";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import "reflect-metadata";
import { ChatModule } from "../src/modules/chat/chat.module";
import { OrdersModule } from "../src/modules/orders/orders.module";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PharmacyNotificationsService } from "../src/modules/pharmacy-notifications/pharmacy-notifications.service";
import { AlertsPharmacyNotifier } from "../src/modules/chat/pharmacy/ports";
import { PHARMACY_HANDOFFS_PORT, PHARMACY_NOTIFIER_PORT, PHARMACY_ORDERS_PORT } from "../src/modules/chat/pharmacy/types";
import { AlertsService } from "../src/modules/alerts/alerts.service";

type ProviderDef = { provide?: unknown; useExisting?: unknown };

function providerFor(token: unknown): ProviderDef | undefined {
  const providers = (Reflect.getMetadata("providers", ChatModule) ?? []) as ProviderDef[];
  return providers.find((p) => typeof p === "object" && p !== null && p.provide === token);
}

test("chat engine ports are bound to the real domain services", () => {
  assert.equal(providerFor(PHARMACY_ORDERS_PORT)?.useExisting, OrdersService);
  assert.equal(providerFor(PHARMACY_NOTIFIER_PORT)?.useExisting, PharmacyNotificationsService);
  assert.ok(providerFor(PHARMACY_HANDOFFS_PORT), "handoffs port stays bound");
  const imports = (Reflect.getMetadata("imports", ChatModule) ?? []) as unknown[];
  assert.ok(imports.includes(OrdersModule), "ChatModule imports OrdersModule so OrdersService is injectable");
  const exported = (Reflect.getMetadata("exports", OrdersModule) ?? []) as unknown[];
  assert.ok(exported.includes(OrdersService));
});

test("OrdersService satisfies the port: createFromCart exists and it writes its own notifications", () => {
  assert.equal(typeof OrdersService.prototype.createFromCart, "function");
  const svc = new OrdersService({} as any, {} as any, {} as any, {} as any, {} as any);
  assert.equal(svc.handlesNotifications, true);
});

function fakePrisma() {
  const alerts: Array<Record<string, unknown>> = [];
  const client = {
    businessAlert: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        alerts.push({ ...data, dismissedAt: null });
        return data;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => alerts.find((a) => a.type === where.type && a.businessId === where.businessId && (where.actionHref === undefined || a.actionHref === where.actionHref) && !a.dismissedAt) ?? null,
    },
    business: { findUnique: async () => ({ email: null }) },
    businessMember: { findMany: async () => [] },
  };
  return { prisma: { client } as any, alerts };
}

test("notifier bound to PharmacyNotificationsService: an urgent handoff alert is never hidden by an older warning", async () => {
  const { prisma, alerts } = fakePrisma();
  const svc = new PharmacyNotificationsService(prisma, {} as any);
  await svc.notify({ type: "new_handoff", businessId: "b1", handoffId: "h1", urgent: false, reason: "symptom" });
  await svc.notify({ type: "new_handoff", businessId: "b1", handoffId: "h2", urgent: true, reason: "symptom" });
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((a) => a.severity), ["warning", "critical"]);
  assert.ok(!alerts.some((a) => /sintoma|dor|febre/i.test(String(a.message))), "no health text in alerts");
});

test("fallback AlertsPharmacyNotifier uses a separate type for urgent handoffs", async () => {
  const { prisma, alerts } = fakePrisma();
  const notifier = new AlertsPharmacyNotifier(new AlertsService(prisma));
  await notifier.notify({ type: "new_handoff", businessId: "b1", handoffId: "h1", urgent: false, reason: "symptom" });
  await notifier.notify({ type: "new_handoff", businessId: "b1", handoffId: "h2", urgent: true, reason: "symptom" });
  assert.equal(alerts.length, 2, "the urgent alert is created although a warning of the base type is active");
  assert.notEqual(alerts[0].type, alerts[1].type);
  assert.equal(alerts[1].severity, "critical");
});

// Importing the Nest modules loads Redis/BullMQ clients that keep the event loop alive; let the runner finish.
after(() => {
  setTimeout(() => process.exit(0), 200);
});

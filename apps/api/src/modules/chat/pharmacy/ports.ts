// Prisma-direct default implementations of the engine's ports (orders, handoffs, notifications).
// They live in chat/ so the chat engine does not depend on wave 2b finishing; wave 3 may bind
// PHARMACY_ORDERS_PORT to 2b's OrdersService.createFromCart (same input/output shape, API.md 8.3).

import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { AlertsService } from "../../alerts/alerts.service";
import { settingsView } from "./catalog";
import { autoConfirmDecision, canEnterOrder, effectiveMaxQty } from "./rules";
import type {
  CreateHandoffInput,
  CreateOrderInput,
  CreatedOrder,
  PharmacyEvent,
  PharmacyHandoffsPort,
  PharmacyNotifierPort,
  PharmacyOrdersPort,
  ProductRow,
} from "./types";

export class OrderRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OrderRuleError";
  }
}

@Injectable()
export class PrismaPharmacyOrders implements PharmacyOrdersPort {
  readonly handlesNotifications = false;

  constructor(private readonly prisma: PrismaService) {}

  async createFromCart(input: CreateOrderInput): Promise<CreatedOrder> {
    const client = this.prisma.client as any;
    if (input.items.length === 0) throw new OrderRuleError("EMPTY_CART", "Carrinho vazio.");
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = (await client.product.findMany({ where: { businessId: input.businessId, id: { in: ids } } })) as ProductRow[];
    const byId = new Map(products.map((p) => [p.id, p]));
    const settings = settingsView(await client.pharmacySettings.findUnique({ where: { businessId: input.businessId } }));

    // Prescriptions attached to this order must belong to this business + conversation and be unattached.
    let prescriptionIds: string[] = [];
    if (input.prescriptionIds?.length) {
      const rows = await client.prescriptionUpload.findMany({
        where: { businessId: input.businessId, id: { in: input.prescriptionIds }, orderId: null, conversationId: input.conversationId },
      });
      prescriptionIds = rows.filter((r: { status: string }) => r.status !== "rejected").map((r: { id: string }) => r.id);
    }
    const hasRxUpload = prescriptionIds.length > 0;

    const lines: { product: ProductRow; qty: number; viaEquivalentOf?: string }[] = [];
    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) throw new OrderRuleError("PRODUCT_NOT_FOUND", "Produto não encontrado.");
      const qty = Math.floor(item.qty);
      if (!(qty >= 1)) throw new OrderRuleError("INVALID_QTY", "Quantidade inválida.");
      const allowed = canEnterOrder(product, hasRxUpload);
      if (!allowed.ok) throw new OrderRuleError("CLASS_BLOCKED", `Produto não pode ser pedido no chat (${allowed.reason}).`);
      if (qty > effectiveMaxQty(product, settings)) throw new OrderRuleError("QTY_OVER_LIMIT", "Quantidade acima do limite por pedido.");
      lines.push({ product, qty, viaEquivalentOf: item.viaEquivalentOf });
    }

    const hasPrescription = hasRxUpload || lines.some((l) => l.product.saleClass === "prescription");
    if (lines.some((l) => l.product.saleClass === "prescription") && !hasRxUpload) {
      throw new OrderRuleError("PRESCRIPTION_REQUIRED", "Este pedido exige receita anexada.");
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.product.priceCents * l.qty, 0);
    const deliveryFeeCents = input.fulfillment === "delivery" ? settings.deliveryFeeCents : 0;
    const totalCents = subtotalCents + deliveryFeeCents;
    const decision = autoConfirmDecision({
      items: lines,
      settings,
      fulfillment: input.fulfillment,
      address: input.address ?? null,
      hasPrescription,
      requirePharmacist: input.requirePharmacist,
    });
    const status = decision.autoConfirm ? "confirmed" : "pending_pharmacist";
    const statusToken = randomBytes(24).toString("base64url");
    const swapNote = lines.some((l) => l.viaEquivalentOf) ? "Cliente escolheu um equivalente de produto sem estoque: confirmar com o cliente antes de separar." : null;
    const notes = [input.notes, swapNote].filter(Boolean).join(" ") || null;
    const sheetDates = lines.map((l) => l.product.stockAsOf).filter((d): d is Date => Boolean(d));
    const stockAsOfSnapshot = sheetDates.length === lines.length && sheetDates.length > 0 ? new Date(Math.min(...sheetDates.map((d) => d.getTime()))) : null;

    const created = await client.$transaction(async (tx: any) => {
      await tx.pharmacySettings.upsert({ where: { businessId: input.businessId }, update: {}, create: { businessId: input.businessId } });
      const rows = (await tx.$queryRawUnsafe(
        'UPDATE "PharmacySettings" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE "businessId" = $1 RETURNING "nextOrderNumber" - 1 AS n',
        input.businessId,
      )) as Array<{ n: number | bigint }>;
      const number = Number(rows[0].n);
      const order = await tx.order.create({
        data: {
          businessId: input.businessId,
          leadId: input.leadId,
          conversationId: input.conversationId,
          number,
          code: `PED-${number}`,
          statusToken,
          fulfillment: input.fulfillment,
          status,
          paymentMethod: "on_delivery",
          subtotalCents,
          deliveryFeeCents,
          totalCents,
          addressSnapshot: input.fulfillment === "delivery" && input.address ? input.address : null,
          addressDiffersFromSaved: Boolean(input.addressDiffersFromSaved),
          notes,
          autoConfirmed: decision.autoConfirm,
          hasPrescription,
          stockAsOfSnapshot,
          confirmedAt: decision.autoConfirm ? new Date() : null,
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              nameSnapshot: l.product.presentation ? `${l.product.name} · ${l.product.presentation}` : l.product.name,
              unitPriceCents: l.product.priceCents,
              qty: l.qty,
              saleClassSnapshot: l.product.saleClass,
            })),
          },
        },
      });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, businessId: input.businessId, fromStatus: null, toStatus: "pending_pharmacist", byName: "Cliente" } });
      if (decision.autoConfirm) {
        await tx.orderStatusEvent.create({
          data: { orderId: order.id, businessId: input.businessId, fromStatus: "pending_pharmacist", toStatus: "confirmed", byName: "Sistema", reason: "Confirmação automática" },
        });
      }
      if (prescriptionIds.length > 0) {
        await tx.prescriptionUpload.updateMany({ where: { businessId: input.businessId, id: { in: prescriptionIds }, orderId: null }, data: { orderId: order.id } });
      }
      return order;
    });

    return {
      id: created.id,
      code: created.code,
      number: created.number,
      status,
      statusToken,
      autoConfirmed: decision.autoConfirm,
      hasPrescription,
      subtotalCents,
      deliveryFeeCents,
      totalCents,
      staleSheet: decision.staleSheet,
      pendingReasons: decision.reasons,
    };
  }
}

const HANDOFF_DEDUPE_MS = 6 * 3600_000;
const HANDOFF_BRIEF_RETENTION_DAYS = 90;

@Injectable()
export class PrismaPharmacyHandoffs implements PharmacyHandoffsPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateHandoffInput): Promise<{ id: string; reused: boolean }> {
    const client = this.prisma.client as any;
    // Every general_question is its own handoff (different questions must not overwrite each other's summary).
    const existing =
      input.reason === "general_question"
        ? null
        : await client.pharmacistHandoff.findFirst({
            where: { businessId: input.businessId, conversationId: input.conversationId, reason: input.reason, status: "open" },
            orderBy: { createdAt: "desc" },
          });
    if (existing && Date.now() - new Date(existing.createdAt).getTime() < HANDOFF_DEDUPE_MS) {
      // The same open request: keep one row. An urgent escalation (red flag) keeps what the questionnaire
      // already collected and adds the red flag; otherwise the latest brief wins (follow-ups are kept).
      const old = (existing.brief && typeof existing.brief === "object" ? existing.brief : {}) as Record<string, unknown>;
      const incoming = input.brief;
      let brief: Record<string, unknown>;
      if (input.urgent && !existing.urgent) {
        const flags = [...new Set([...(Array.isArray(old.redFlags) ? (old.redFlags as string[]) : []), ...(Array.isArray(incoming.redFlags) ? (incoming.redFlags as string[]) : [])])];
        brief = { ...incoming, ...old, redFlags: flags, customerText: incoming.customerText ?? old.customerText };
      } else {
        brief = { ...incoming, ...(old.followUps ? { followUps: old.followUps } : {}), ...(old.inProgress ? { inProgress: old.inProgress } : {}), ...(!incoming.contact && old.contact ? { contact: old.contact } : {}) };
      }
      await client.pharmacistHandoff.update({
        where: { id: existing.id },
        data: { urgent: existing.urgent || input.urgent, brief: brief as object, summary: input.urgent && !existing.urgent ? input.summary : existing.summary || input.summary },
      });
      return { id: existing.id, reused: true };
    }
    const row = await client.pharmacistHandoff.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        leadId: input.leadId ?? null,
        reason: input.reason,
        urgent: input.urgent,
        summary: input.summary,
        brief: input.brief as object,
        retentionDeleteAt: new Date(Date.now() + HANDOFF_BRIEF_RETENTION_DAYS * 86_400_000),
      },
    });
    return { id: row.id, reused: false };
  }
}

@Injectable()
export class AlertsPharmacyNotifier implements PharmacyNotifierPort {
  private readonly logger = new Logger(AlertsPharmacyNotifier.name);

  constructor(private readonly alerts: AlertsService) {}

  async notify(event: PharmacyEvent): Promise<void> {
    try {
      if (event.type === "new_order") {
        await this.alerts.createAlert(event.businessId, {
          type: "pharmacy_new_order",
          severity: "info",
          message: `Novo pedido ${event.orderCode}.`,
          actionLabel: "Abrir pedidos",
          actionHref: "/pedidos",
        });
      } else if (event.type === "new_handoff") {
        await this.alerts.createAlert(event.businessId, {
          // Urgent ones get their own type: AlertsService de-duplicates by type while an alert is active, so an
          // older "warning" of the same type would otherwise hide a critical one.
          type: event.urgent ? "pharmacy_urgent_handoff" : "pharmacy_new_handoff",
          severity: event.urgent ? "critical" : "warning",
          message: event.urgent
            ? "Atendimento URGENTE aguardando o farmacêutico."
            : event.reason === "general_question"
              ? "Nova pergunta de cliente aguardando resposta"
              : "Novo atendimento aguardando o farmacêutico.",
          actionLabel: "Abrir atendimentos",
          actionHref: "/atendimento",
        });
      }
    } catch (error) {
      // Never fail the visitor turn because a notification failed (non-disableable, but best effort here).
      this.logger.warn(`pharmacy notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

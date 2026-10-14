import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadOperationMode } from "../pharmacy-common/operation-mode";
import { randomBytes } from "crypto";
import { Prisma } from "@realwise/db";
import { resolveBranding, type NicheKey } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import { accessDenied } from "../access/access-errors";
import type { MemberContext } from "../access/member-context";
import { CustomerProfileService } from "../customers/customer-profile.service";
import type { AddressFields } from "../customers/address-utils";
import { PharmacyNotificationsService } from "../pharmacy-notifications/pharmacy-notifications.service";
import { PharmacySettingsService } from "../pharmacy-settings/pharmacy-settings.service";
import { nextOrderNumber } from "../pharmacy-common/counters";
import { sliceCursor, parseLimit } from "../pharmacy-common/format";
import { CANCEL_REASONS, ORDER_STATUS_LABEL, ORDER_TAB_STATUSES, orderTab, type CancelReasonCode, type OrderStatus, type OrderTab, type SaleClass } from "../pharmacy-common/labels";
import { escapeHtml, sendEmail } from "../../common/email";
import { computeRetentionDeleteAt } from "../prescriptions/retention";
import { autoConfirmDecision, canEnterCart, type CartRefusal, type DeliveryArea } from "./auto-confirm";
import { orderDetailDto, orderListDto, publicOrderDto, rxPendingOf, type OrderRow } from "./order-dto";
import { evaluateTransition, isClosed, type ActorContext, type Fulfillment, type OrderAction } from "./order-state";

const logger = new Logger("OrdersService");

const LIST_INCLUDE = {
  lead: { select: { id: true, name: true, phone: true, email: true } },
  items: true,
  prescriptions: { select: { id: true, number: true, status: true }, orderBy: { number: "asc" as const } },
} as const;
const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  events: { orderBy: { createdAt: "asc" as const } },
  courier: { select: { id: true, name: true } },
} as const;

function dom(status: 400 | 403 | 409, code: string, message: string, extra: Record<string, unknown> = {}) {
  const body = { statusCode: status, error: status === 400 ? "Bad Request" : status === 403 ? "Forbidden" : "Conflict", code, message, ...extra };
  return status === 400 ? new BadRequestException(body) : status === 403 ? new ForbiddenException(body) : new ConflictException(body);
}

const REFUSAL_MESSAGE: Record<CartRefusal, string> = {
  inactive: "Produto indisponível.",
  controlled: "Medicamento controlado não pode ser vendido online.",
  unclassified: "Produto sem classe não pode ser vendido online.",
  class_unconfirmed: "A classe do produto ainda não foi confirmada pelo farmacêutico.",
  pharmacist_required: "Este produto sempre passa pelo farmacêutico.",
  prescription_required: "Este produto exige o envio da receita.",
  out_of_stock: "Produto sem estoque suficiente.",
  qty_over_limit: "Quantidade acima do limite por pedido.",
  invalid_qty: "Quantidade inválida.",
};

export interface CreateFromCartInput {
  businessId: string;
  leadId: string;
  conversationId?: string | null;
  fulfillment: Fulfillment;
  items: Array<{ productId: string; qty: number; viaEquivalentOf?: string }>;
  address?: AddressFields | null;
  prescriptionIds?: string[];
  notes?: string | null;
  /** The chat decided this order must wait for the pharmacist (equivalent chosen, address outside area, ...). */
  requirePharmacist?: boolean;
  requireReasons?: string[];
  /** When omitted it is computed against the lead's saved default address. */
  addressDiffersFromSaved?: boolean;
}

export interface CreatedOrder {
  id: string;
  code: string;
  number: number;
  status: OrderStatus;
  autoConfirmed: boolean;
  statusToken: string;
  statusUrl: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  hasPrescription: boolean;
  /** true when the catalog stock sheet was older than stockMaxAgeHours (or unknown) at order time. */
  staleSheet: boolean;
  /** Why it was not auto-confirmed (stable codes; never shown to the customer verbatim). Empty when auto-confirmed. */
  pendingReasons: string[];
}

export function orderStatusUrl(statusToken: string): string {
  const base = (process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005/client/conversation").replace(/\/+$/, "");
  return `${base}/pedido/${statusToken}`;
}

@Injectable()
export class OrdersService {
  /** Drop-in for the chat engine's PharmacyOrdersPort: this service writes alerts/emails itself. */
  readonly handlesNotifications = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    private readonly notifications: PharmacyNotificationsService,
    private readonly settings: PharmacySettingsService,
    private readonly customers: CustomerProfileService,
  ) {}

  // ------------------------------------------------------------------ reads

  private actorOf(m: MemberContext): ActorContext {
    return { memberId: m.memberId, ownDeliveriesOnly: m.ownDeliveriesOnly };
  }

  private scope(m: MemberContext): Prisma.OrderWhereInput {
    return { businessId: m.businessId, ...(m.ownDeliveriesOnly ? { courierMemberId: m.memberId } : {}) };
  }

  async list(m: MemberContext, q: { status?: string; fulfillment?: string; q?: string; limit?: string; cursor?: string }) {
    const limit = parseLimit(q.limit);
    const settings = await this.settings.getRow(m.businessId);
    const search = q.q?.trim();
    const base: Prisma.OrderWhereInput = {
      ...this.scope(m),
      ...(q.fulfillment === "delivery" || q.fulfillment === "pickup" ? { fulfillment: q.fulfillment } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { lead: { name: { contains: search, mode: "insensitive" } } },
              ...(search.replace(/\D/g, "").length >= 4 ? [{ lead: { phone: { contains: search.replace(/\D/g, "") } } }] : []),
            ],
          }
        : {}),
    };
    const tab = q.status as OrderTab | undefined;
    const where: Prisma.OrderWhereInput = { ...base, ...(tab && tab in ORDER_TAB_STATUSES ? { status: { in: ORDER_TAB_STATUSES[tab] } } : {}) };
    const [rows, grouped] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: tab === "new" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.order.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    ]);
    const counts: Record<OrderTab, number> = { new: 0, confirmed: 0, out: 0, done: 0, canceled: 0 };
    for (const g of grouped) counts[orderTab(g.status as OrderStatus)] += g._count._all;
    const { items, nextCursor } = sliceCursor(rows, limit);
    return { items: items.map((o) => orderListDto(o as unknown as OrderRow, settings.stockMaxAgeHours)), counts, nextCursor };
  }

  private async loadFor(m: MemberContext, id: string) {
    // A courier asking for somebody else's order gets the same 404 as a nonexistent one.
    const o = await this.prisma.client.order.findFirst({ where: { id, ...this.scope(m) }, include: DETAIL_INCLUDE });
    if (!o) throw new NotFoundException("Pedido não encontrado.");
    return o;
  }

  private async detail(m: MemberContext, id: string) {
    const [o, settings] = await Promise.all([this.loadFor(m, id), this.settings.getRow(m.businessId)]);
    return orderDetailDto(o as unknown as OrderRow, { maxAgeHours: settings.stockMaxAgeHours, actor: this.actorOf(m) });
  }

  get(m: MemberContext, id: string) {
    return this.detail(m, id);
  }

  async couriers(businessId: string) {
    const rows = await this.prisma.client.businessMember.findMany({
      where: { businessId, status: "active", role: { ownDeliveriesOnly: true } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { items: rows };
  }

  // ------------------------------------------------------------------ transitions

  async transition(m: MemberContext, id: string, action: OrderAction, body: { reasonCode?: string; note?: string } = {}) {
    // Courier touching another courier's order: 403 OWN_DELIVERIES_ONLY (decided in evaluateTransition);
    // nonexistent / other business: 404.
    const o = await this.prisma.client.order.findFirst({ where: { id, businessId: m.businessId }, include: DETAIL_INCLUDE });
    if (!o) throw new NotFoundException("Pedido não encontrado.");
    const verdict = evaluateTransition(
      { status: o.status as OrderStatus, fulfillment: o.fulfillment as Fulfillment, rxPending: rxPendingOf(o as unknown as OrderRow), courierMemberId: o.courierMemberId },
      action,
      this.actorOf(m),
    );
    if (!verdict.ok) {
      switch (verdict.code) {
        case "OWN_DELIVERIES_ONLY":
          throw accessDenied("OWN_DELIVERIES_ONLY", "Entregadores só atualizam as próprias entregas.");
        case "COURIER_ACTION_DENIED":
          throw accessDenied("PERMISSION_DENIED", "Entregadores só podem marcar saída e entrega.", { section: "pedidos", required: "edit" });
        case "RX_PENDING":
          throw dom(409, "RX_PENDING", "Valide a receita antes de confirmar o pedido.");
        case "INVALID_TRANSITION":
          throw dom(409, "INVALID_TRANSITION", "Esta ação não é possível no status atual do pedido.", { from: o.status, action, allowed: verdict.allowed });
      }
    }

    let reason: string | null = null;
    if (action === "cancel") {
      const reasonCode = body.reasonCode as CancelReasonCode | undefined;
      const def = CANCEL_REASONS.find((r) => r.code === reasonCode);
      if (!def) throw dom(400, "REASON_REQUIRED", "Informe o motivo do cancelamento.");
      const note = (body.note ?? "").trim().slice(0, 300);
      if (def.code === "other" && note.length < 3) throw dom(400, "NOTE_REQUIRED", 'Descreva o motivo em "Outro motivo".');
      reason = note ? `${def.label}: ${note}` : def.label;
    }

    const now = new Date();
    const to = verdict.to;
    const res = await this.prisma.client.order.updateMany({
      where: { id: o.id, businessId: m.businessId, status: o.status },
      data: {
        status: to,
        ...(to === "confirmed" ? { confirmedAt: now } : {}),
        ...(to === "delivered" ? { deliveredAt: now } : {}),
        ...(to === "canceled" ? { canceledAt: now, statusReason: reason } : {}),
      },
    });
    if (res.count === 0) throw dom(409, "INVALID_TRANSITION", "O pedido foi alterado por outra pessoa. Atualize a tela.", { from: o.status, action, allowed: [] });
    await this.prisma.client.orderStatusEvent.create({
      data: { orderId: o.id, businessId: m.businessId, fromStatus: o.status, toStatus: to, byMemberId: m.memberId, byName: m.name, reason },
    });
    await this.afterTransition(o, to, m.businessId, now);
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: `order.${action}`,
      target: o.code,
      summary: this.summaryFor(action, o.code, reason),
    });
    return this.detail(m, id);
  }

  private summaryFor(action: OrderAction, code: string, reason: string | null): string {
    switch (action) {
      case "confirm":
        return `Confirmou o pedido ${code}`;
      case "out":
        return `Marcou ${code} como saiu / pronto`;
      case "done":
        return `Concluiu o pedido ${code}`;
      case "cancel":
        return `Cancelou o pedido ${code}${reason ? ` (${reason.split(":")[0]})` : ""}`;
    }
  }

  private async afterTransition(o: { id: string; code: string; statusToken: string; businessId: string; lead: { email: string | null } }, to: OrderStatus, businessId: string, now: Date) {
    if (to !== "pending_pharmacist") void this.notifications.orderHandled(businessId, o.code).catch(() => {});
    if (isClosed(to)) await this.startRetentionClock(o.id, businessId, now);
    void this.notifyCustomer(o, to).catch((e) => logger.warn(`customer notification failed: ${e instanceof Error ? e.message : e}`));
  }

  /** Order closed: prescriptions get retentionDeleteAt = max(closedAt, reviewedAt) + retention days. */
  private async startRetentionClock(orderId: string, businessId: string, closedAt: Date) {
    const settings = await this.settings.getRow(businessId);
    const rxs = await this.prisma.client.prescriptionUpload.findMany({ where: { orderId, businessId, fileDeletedAt: null } });
    for (const rx of rxs) {
      await this.prisma.client.prescriptionUpload.update({
        where: { id: rx.id },
        data: { retentionDeleteAt: computeRetentionDeleteAt({ uploadedAt: rx.createdAt, closedAt, reviewedAt: rx.reviewedAt, retentionDays: settings.prescriptionRetentionDays }) },
      });
    }
  }

  /** Status page is the primary channel; email is a stub that logs without RESEND_API_KEY. No health data. */
  private async notifyCustomer(o: { code: string; statusToken: string; lead: { email: string | null } }, to: OrderStatus) {
    if (!o.lead.email || to === "pending_pharmacist") return;
    const label = ORDER_STATUS_LABEL[to];
    const html = `<p>Seu pedido <strong>${escapeHtml(o.code)}</strong> agora está: <strong>${escapeHtml(label)}</strong>.</p><p><a href="${escapeHtml(orderStatusUrl(o.statusToken))}">Acompanhar pedido</a></p>`;
    await sendEmail(o.lead.email, `Pedido ${o.code}: ${label}`, html);
  }

  async assignCourier(m: MemberContext, id: string, memberId: string | null) {
    if (m.ownDeliveriesOnly) throw accessDenied("PERMISSION_DENIED", "Entregadores não atribuem entregas.", { section: "pedidos", required: "edit" });
    const o = await this.prisma.client.order.findFirst({ where: { id, businessId: m.businessId }, select: { id: true, code: true, status: true } });
    if (!o) throw new NotFoundException("Pedido não encontrado.");
    if (isClosed(o.status as OrderStatus)) throw dom(409, "ORDER_CLOSED", "Pedidos encerrados não podem ter entregador.");
    let courierName: string | null = null;
    if (memberId) {
      const courier = await this.prisma.client.businessMember.findFirst({ where: { id: memberId, businessId: m.businessId, status: "active", role: { ownDeliveriesOnly: true } }, select: { name: true } });
      if (!courier) throw dom(400, "INVALID_COURIER", "Escolha um entregador ativo.");
      courierName = courier.name;
    }
    await this.prisma.client.order.update({ where: { id }, data: { courierMemberId: memberId } });
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "order.assign_courier",
      target: o.code,
      summary: memberId ? `Atribuiu ${o.code} a ${courierName}` : `Removeu o entregador de ${o.code}`,
    });
    return this.detail(m, id);
  }

  /**
   * System transition used when a prescription is rejected: pending_pharmacist -> rejected
   * (docs/pharmacy/API.md 2.1). Terminal. No-op when the order is no longer waiting.
   */
  async rejectForPrescription(businessId: string, orderId: string, reason: string, by: { memberId: string; name: string }) {
    const o = await this.prisma.client.order.findFirst({ where: { id: orderId, businessId }, include: { lead: { select: { email: true } } } });
    if (!o || o.status !== "pending_pharmacist") return false;
    const now = new Date();
    const res = await this.prisma.client.order.updateMany({ where: { id: o.id, businessId, status: "pending_pharmacist" }, data: { status: "rejected", statusReason: reason, canceledAt: now } });
    if (res.count === 0) return false;
    await this.prisma.client.orderStatusEvent.create({ data: { orderId: o.id, businessId, fromStatus: "pending_pharmacist", toStatus: "rejected", byMemberId: by.memberId, byName: by.name, reason } });
    await this.afterTransition(o, "rejected", businessId, now);
    return true;
  }

  // ------------------------------------------------------------------ creation (called by the chat engine)

  async createFromCart(input: CreateFromCartInput): Promise<CreatedOrder> {
    const { businessId } = input;
    const lead = await this.prisma.client.lead.findFirst({ where: { id: input.leadId, businessId }, select: { id: true } });
    if (!lead) throw dom(400, "LEAD_NOT_FOUND", "Cliente não encontrado.");
    if (!Array.isArray(input.items) || input.items.length === 0) throw dom(400, "EMPTY_CART", "O carrinho está vazio.");

    // merge duplicate lines
    const qtyByProduct = new Map<string, number>();
    for (const it of input.items) {
      if (!it || typeof it.productId !== "string" || !Number.isInteger(it.qty) || it.qty < 1) throw dom(400, "INVALID_ITEM", "Item inválido.");
      qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.qty);
    }
    const settings = await this.settings.getRow(businessId);
    const products = await this.prisma.client.product.findMany({ where: { businessId, deletedAt: null, id: { in: [...qtyByProduct.keys()] } } });
    if (products.length !== qtyByProduct.size) throw dom(400, "PRODUCT_NOT_FOUND", "Um dos produtos não está mais disponível.");

    const prescriptionIds = [...new Set(input.prescriptionIds ?? [])];
    const rxRows = prescriptionIds.length
      ? await this.prisma.client.prescriptionUpload.findMany({ where: { id: { in: prescriptionIds }, businessId, orderId: null, fileDeletedAt: null, status: { not: "rejected" } } })
      : [];
    if (rxRows.length !== prescriptionIds.length) throw dom(400, "PRESCRIPTION_NOT_FOUND", "Receita não encontrada ou já usada em outro pedido.");
    for (const rx of rxRows) {
      // The upload belongs to this customer / conversation, never to someone else's.
      if ((rx.leadId && rx.leadId !== input.leadId) || (!rx.leadId && rx.conversationId && rx.conversationId !== input.conversationId)) {
        throw dom(400, "PRESCRIPTION_NOT_FOUND", "Receita não encontrada ou já usada em outro pedido.");
      }
    }
    const hasRxUpload = rxRows.length > 0;

    // Hard rules, re-checked against the DB (never trust the chat state).
    const lines = products.map((p) => ({ product: p, qty: qtyByProduct.get(p.id) as number }));
    for (const { product, qty } of lines) {
      const verdict = canEnterCart(
        { saleClass: product.saleClass as SaleClass, classConfirmedAt: product.classConfirmedAt, pharmacistRequired: product.pharmacistRequired, active: product.active, stockQty: product.stockQty, maxQtyPerOrder: product.maxQtyPerOrder },
        qty,
        { maxQtyDefault: settings.maxQtyPerItemDefault, hasPrescriptionUpload: hasRxUpload },
      );
      if (!verdict.ok) throw dom(400, `CART_${verdict.reason.toUpperCase()}`, `${product.name}: ${REFUSAL_MESSAGE[verdict.reason]}`, { productId: product.id, reason: verdict.reason, ...(verdict.maxQty ? { maxQty: verdict.maxQty } : {}) });
    }
    const hasRxProduct = lines.some((l) => l.product.saleClass === "prescription");
    const hasPrescription = hasRxProduct || hasRxUpload;

    if (input.fulfillment === "delivery") {
      if (!settings.deliveryEnabled) throw dom(400, "DELIVERY_DISABLED", "A farmácia não faz entregas no momento.");
      if (!input.address) throw dom(400, "ADDRESS_REQUIRED", "Informe o endereço de entrega.");
    } else if (!settings.pickupEnabled) {
      throw dom(400, "PICKUP_DISABLED", "A farmácia não oferece retirada no momento.");
    }
    const subtotalCents = lines.reduce((n, l) => n + l.product.priceCents * l.qty, 0);
    if (input.fulfillment === "delivery" && settings.minOrderCents > 0 && subtotalCents < settings.minOrderCents) {
      throw dom(400, "ORDER_BELOW_MINIMUM", "O pedido está abaixo do valor mínimo.", { minOrderCents: settings.minOrderCents });
    }
    const deliveryFeeCents = input.fulfillment === "delivery" ? settings.deliveryFeeCents : 0;
    const totalCents = subtotalCents + deliveryFeeCents;

    // Freshness is per product row (a manual stock edit refreshes just that row): the oldest line decides.
    const lineDates = lines.map((l) => l.product.stockAsOf);
    const sheetAsOf = lineDates.every((d): d is Date => !!d) ? new Date(Math.min(...lineDates.map((d) => d.getTime()))) : null;
    const decision = autoConfirmDecision({
      autoConfirmEnabled: settings.autoConfirmEnabled && !input.requirePharmacist,
      stockMaxAgeHours: settings.stockMaxAgeHours,
      maxQtyDefault: settings.maxQtyPerItemDefault,
      deliveryAreas: (settings.deliveryAreas ?? []) as unknown as DeliveryArea[],
      fulfillment: input.fulfillment,
      address: input.address ? { district: input.address.district, cep: input.address.cep } : null,
      hasPrescription,
      sheetAsOf,
      items: lines.map((l) => ({ saleClass: l.product.saleClass as SaleClass, classConfirmedAt: l.product.classConfirmedAt, pharmacistRequired: l.product.pharmacistRequired, active: l.product.active, stockQty: l.product.stockQty, maxQtyPerOrder: l.product.maxQtyPerOrder, qty: l.qty })),
    });
    const pendingReasons = decision.auto ? [] : [...new Set([...(input.requirePharmacist ? ["requested_by_chat", ...(input.requireReasons ?? [])] : []), ...decision.reasons.filter((r) => r !== "auto_confirm_disabled" || !input.requirePharmacist)])];
    const staleSheet = decision.reasons.includes("stale_sheet");
    const swapNote = input.items.some((i) => i.viaEquivalentOf) ? "Cliente escolheu um equivalente de produto sem estoque: confirmar com o cliente antes de separar." : null;
    const notes = [input.notes?.trim(), swapNote].filter(Boolean).join(" ").slice(0, 500) || null;
    const status: OrderStatus = decision.auto ? "confirmed" : "pending_pharmacist";
    const differs = input.addressDiffersFromSaved ?? (input.fulfillment === "delivery" && input.address ? await this.customers.differsFromSavedDefault(businessId, input.leadId, input.address) : false);
    const statusToken = randomBytes(24).toString("hex");
    const now = new Date();
    const snapshot = input.address ? { ...input.address, cep: input.address.cep.replace(/\D/g, "") } : null;

    const created = await this.prisma.client.$transaction(async (tx) => {
      const number = await nextOrderNumber(tx as any, businessId);
      const order = await tx.order.create({
        data: {
          businessId,
          leadId: input.leadId,
          conversationId: input.conversationId ?? null,
          number,
          code: `PED-${number}`,
          statusToken,
          fulfillment: input.fulfillment,
          status,
          paymentMethod: "on_delivery",
          subtotalCents,
          deliveryFeeCents,
          totalCents,
          addressSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          addressDiffersFromSaved: differs,
          notes,
          autoConfirmed: decision.auto,
          hasPrescription,
          stockAsOfSnapshot: sheetAsOf,
          confirmedAt: decision.auto ? now : null,
          items: {
            create: lines.map((l) => ({ productId: l.product.id, nameSnapshot: [l.product.name, l.product.presentation].filter(Boolean).join(" · "), unitPriceCents: l.product.priceCents, qty: l.qty, saleClassSnapshot: l.product.saleClass })),
          },
        },
      });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, businessId, fromStatus: null, toStatus: "pending_pharmacist", byName: "Cliente" } });
      if (decision.auto) await tx.orderStatusEvent.create({ data: { orderId: order.id, businessId, fromStatus: "pending_pharmacist", toStatus: "confirmed", byName: "Sistema" } });
      if (rxRows.length) {
        const attach = await tx.prescriptionUpload.updateMany({ where: { id: { in: rxRows.map((r) => r.id) }, businessId, orderId: null }, data: { orderId: order.id, leadId: input.leadId } });
        if (attach.count !== rxRows.length) throw dom(409, "PRESCRIPTION_TAKEN", "A receita já foi usada em outro pedido.");
      }
      return order;
    });

    void this.notifications.newOrder({ businessId, code: created.code, totalCents, fulfillment: input.fulfillment, autoConfirmed: decision.auto }).catch(() => {});
    return {
      id: created.id,
      code: created.code,
      number: created.number,
      status,
      autoConfirmed: decision.auto,
      statusToken,
      statusUrl: orderStatusUrl(statusToken),
      subtotalCents,
      deliveryFeeCents,
      totalCents,
      hasPrescription,
      staleSheet,
      pendingReasons,
    };
  }

  // ------------------------------------------------------------------ public status page

  async publicStatus(statusToken: string) {
    if (typeof statusToken !== "string" || statusToken.length < 16 || statusToken.length > 128) throw new NotFoundException();
    const o = await this.prisma.client.order.findUnique({
      where: { statusToken },
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true } },
        items: true,
        prescriptions: { select: { id: true, number: true, status: true } },
        events: { orderBy: { createdAt: "asc" } },
        business: { select: { id: true, name: true, logoUrl: true, niche: true, primaryColor: true, secondaryColor: true, tertiaryColor: true, brandColor: true, phone: true } },
      },
    });
    if (!o) throw new NotFoundException();
    const routing = await this.prisma.client.whatsappRoutingNumber.findFirst({ where: { businessId: o.businessId, isActive: true }, orderBy: { priority: "desc" }, select: { phone: true } });
    return publicOrderDto({
      ...(o as unknown as OrderRow),
      events: o.events as any,
      updatedAt: o.updatedAt,
      canceledAt: o.canceledAt,
      business: { name: o.business.name, logoUrl: o.business.logoUrl },
      branding: resolveBranding(o.business.niche as NicheKey, o.business),
      pharmacyPhone: routing?.phone ?? null,
    });
  }

  // ------------------------------------------------------------------ worker jobs

  /** Job `pharmacy:order-reminders` (every minute): one alert per waiting order, refreshed every orderReminderMinutes. */
  async runReminders(now = Date.now()): Promise<{ reminded: number }> {
    const pending = await this.prisma.client.order.findMany({
      where: { status: "pending_pharmacist", business: { niche: "farmacia" } },
      select: { id: true, code: true, businessId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });
    if (!pending.length) return { reminded: 0 };
    // Attendance-mode pharmacies (chosen or forced by plan) have no order workflow: no reminders for old orders.
    const commerceIds = new Set<string>();
    for (const id of new Set(pending.map((p) => p.businessId))) if ((await loadOperationMode(this.prisma.client, id)).effective === "commerce") commerceIds.add(id);
    const businessIds = [...commerceIds];
    if (!businessIds.length) return { reminded: 0 };
    const [settingsRows, alerts] = await Promise.all([
      this.prisma.client.pharmacySettings.findMany({ where: { businessId: { in: businessIds } }, select: { businessId: true, orderReminderMinutes: true } }),
      this.prisma.client.businessAlert.findMany({ where: { businessId: { in: businessIds }, type: "pharmacy_order_waiting", dismissedAt: null }, select: { businessId: true, message: true, createdAt: true } }),
    ]);
    const interval = new Map(settingsRows.map((s) => [s.businessId, s.orderReminderMinutes]));
    let reminded = 0;
    for (const o of pending) {
      if (!commerceIds.has(o.businessId)) continue;
      const everyMin = interval.get(o.businessId) ?? 10;
      const waited = Math.floor((now - o.createdAt.getTime()) / 60000);
      if (waited < everyMin) continue;
      const last = alerts.find((a) => a.businessId === o.businessId && a.message.includes(o.code));
      if (last && now - last.createdAt.getTime() < everyMin * 60000) continue;
      await this.notifications.orderWaiting({ businessId: o.businessId, code: o.code }, waited);
      reminded++;
    }
    return { reminded };
  }

  /** Job `pharmacy:stale-sheet` (hourly): one alert per stale sheet. */
  async runStaleSheetCheck(now = Date.now()): Promise<{ alerted: number }> {
    const settingsRows = await this.prisma.client.pharmacySettings.findMany({ where: { business: { niche: "farmacia", status: "live" } }, select: { businessId: true, stockMaxAgeHours: true } });
    let alerted = 0;
    for (const s of settingsRows) {
      if ((await loadOperationMode(this.prisma.client, s.businessId)).effective !== "commerce") continue;
      const sheet = await this.settings.latestSheet(s.businessId, s.stockMaxAgeHours);
      if (sheet.stale && sheet.ageHours !== null) {
        if (await this.notifications.staleSheet(s.businessId, sheet.ageHours, s.stockMaxAgeHours)) alerted++;
      }
    }
    return { alerted };
  }
}


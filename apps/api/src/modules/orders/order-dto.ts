import { CANCEL_REASONS, CLASS_BADGE, ORDER_STATUS_BADGE, ORDER_STATUS_LABEL, RX_STATUS_LABEL, orderTab, type OrderStatus, type SaleClass } from "../pharmacy-common/labels";
import { formatPhoneBr, minutesSince } from "../pharmacy-common/format";
import { sheetStatus } from "../pharmacy-common/sheet";
import { STATUS_EVENT_LABEL, allowedActions, type ActorContext, type Fulfillment } from "./order-state";

export interface OrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: string;
  addressSnapshot: unknown;
  addressDiffersFromSaved: boolean;
  notes: string | null;
  autoConfirmed: boolean;
  hasPrescription: boolean;
  stockAsOfSnapshot: Date | null;
  statusReason: string | null;
  courierMemberId: string | null;
  conversationId: string | null;
  createdAt: Date;
  lead: { id: string; name: string | null; phone: string; email: string | null };
  items: Array<{ id: string; productId: string; nameSnapshot: string; unitPriceCents: number; qty: number; saleClassSnapshot: SaleClass }>;
  prescriptions: Array<{ id: string; number: number; status: "pending" | "approved" | "rejected" }>;
  events?: Array<{ toStatus: OrderStatus; createdAt: Date; byName: string | null; reason: string | null }>;
  courier?: { id: string; name: string } | null;
}

export const SHORT_CLASS_LABEL: Record<SaleClass, string> = { otc: "OTC", prescription: "Receita", controlled: "Controlado", unclassified: "Sem classe" };

export function kindLabel(o: Pick<OrderRow, "hasPrescription" | "fulfillment">): string {
  if (o.hasPrescription) return "Receita";
  return o.fulfillment === "delivery" ? "Entrega" : "Retirada";
}

/** A pending or rejected prescription blocks confirmation (API.md 2.1). */
export function rxPendingOf(o: Pick<OrderRow, "prescriptions">): boolean {
  return o.prescriptions.some((p) => p.status === "pending" || p.status === "rejected");
}

/** Catalog sheet older than the limit WHEN THE ORDER WAS PLACED. */
export function staleAtOrderTime(o: Pick<OrderRow, "stockAsOfSnapshot" | "createdAt">, maxAgeHours: number): boolean {
  if (!o.stockAsOfSnapshot) return false;
  return o.createdAt.getTime() - o.stockAsOfSnapshot.getTime() > maxAgeHours * 3600_000;
}

export function orderListDto(o: OrderRow, maxAgeHours: number, now = Date.now()) {
  return {
    id: o.id,
    code: o.code,
    customer: { id: o.lead.id, name: o.lead.name ?? "Cliente" },
    itemCount: o.items.reduce((n, i) => n + i.qty, 0),
    totalCents: o.totalCents,
    fulfillment: o.fulfillment,
    kindLabel: kindLabel(o),
    hasPrescription: o.hasPrescription,
    rxPending: rxPendingOf(o),
    status: o.status,
    statusLabel: ORDER_STATUS_LABEL[o.status],
    statusBadge: ORDER_STATUS_BADGE[o.status],
    tab: orderTab(o.status),
    autoConfirmed: o.autoConfirmed,
    originLabel: o.autoConfirmed ? "⚡ automático" : "Chat",
    createdAt: o.createdAt.toISOString(),
    waitingMinutes: o.status === "pending_pharmacist" ? minutesSince(o.createdAt, now) : 0,
    stale: staleAtOrderTime(o, maxAgeHours),
    addressDiffersFromSaved: o.addressDiffersFromSaved,
    needsAction: o.status === "pending_pharmacist",
  };
}

export interface SnapshotAddress {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string | null;
  reference?: string | null;
  district?: string;
  city?: string;
  state?: string;
}

/** Full label for staff: "Rua das Flores, 120B, ap 31 · Água Verde, Curitiba/PR · ref: portão azul". */
export function staffAddressLabel(a: SnapshotAddress): string {
  const street = [a.street, a.number, a.complement].filter((x) => x && String(x).trim()).join(", ");
  const place = `${a.district ?? ""}, ${a.city ?? ""}/${a.state ?? ""}`.replace(/^, /, "");
  return [street, place, a.reference ? `ref: ${a.reference}` : ""].filter(Boolean).join(" · ");
}

/** What the customer-facing status page may show: street number hidden even there. */
export function publicAddressLabel(a: SnapshotAddress): string {
  return `${a.street ?? ""}, nº •••, ${a.district ?? ""}`;
}

export function orderDetailDto(o: OrderRow, ctx: { maxAgeHours: number; actor: ActorContext; now?: number }) {
  const now = ctx.now ?? Date.now();
  const base = orderListDto(o, ctx.maxAgeHours, now);
  const addr = (o.fulfillment === "delivery" ? (o.addressSnapshot as SnapshotAddress | null) : null) ?? null;
  const rxPending = rxPendingOf(o);
  const actions = allowedActions({ status: o.status, fulfillment: o.fulfillment, rxPending, courierMemberId: o.courierMemberId }, ctx.actor);
  const sheet = sheetStatus(o.stockAsOfSnapshot, ctx.maxAgeHours, o.createdAt.getTime());
  return {
    ...base,
    customer: {
      id: o.lead.id,
      name: o.lead.name ?? "Cliente",
      phone: o.lead.phone,
      phoneFormatted: formatPhoneBr(o.lead.phone),
      email: o.lead.email,
    },
    conversationId: o.conversationId,
    address: addr
      ? { label: staffAddressLabel(addr), cep: addr.cep ?? null, street: addr.street ?? null, number: addr.number ?? null, complement: addr.complement ?? null, reference: addr.reference ?? null, district: addr.district ?? null, city: addr.city ?? null, state: addr.state ?? null }
      : null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.nameSnapshot,
      qty: i.qty,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.unitPriceCents * i.qty,
      saleClass: i.saleClassSnapshot,
      classLabel: SHORT_CLASS_LABEL[i.saleClassSnapshot],
      classBadge: CLASS_BADGE[i.saleClassSnapshot],
    })),
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    paymentMethod: o.paymentMethod,
    paymentLabel: o.fulfillment === "pickup" ? "na retirada" : "na entrega",
    notes: o.notes,
    prescriptions: o.prescriptions.map((p) => ({ id: p.id, code: `RX-${p.number}`, status: p.status, statusLabel: RX_STATUS_LABEL[p.status] })),
    stockSheet: { asOf: sheet.asOf, ageHours: sheet.ageHours, stale: staleAtOrderTime(o, ctx.maxAgeHours) },
    courier: o.courier ? { id: o.courier.id, name: o.courier.name } : null,
    statusReason: o.statusReason,
    timeline: (o.events ?? []).map((e) => ({ status: e.toStatus, label: STATUS_EVENT_LABEL[e.toStatus], at: e.createdAt.toISOString(), byName: e.byName ?? "Sistema" })),
    allowedActions: actions,
    actionLabels: {
      confirm: "Confirmar pedido",
      out: o.fulfillment === "delivery" ? "Saiu para entrega" : "Pronto para retirada",
      done: o.fulfillment === "delivery" ? "Entregue" : "Retirado",
      cancel: "Cancelar pedido",
    },
    cancelReasons: CANCEL_REASONS.map((r) => ({ code: r.code, label: r.label })),
  };
}

export interface PublicOrderInput extends OrderRow {
  events: Array<{ toStatus: OrderStatus; createdAt: Date; byName: string | null; reason: string | null }>;
  updatedAt: Date;
  canceledAt: Date | null;
  business: { name: string; logoUrl: string | null };
  branding: { primaryColor: string; secondaryColor: string; tertiaryColor: string };
  pharmacyPhone: string | null;
}

/** Public, token-addressed view of an order (docs/pharmacy/API.md 8.5). Never contains health data. */
export function publicOrderDto(o: PublicOrderInput) {
  const at = (s: OrderStatus) => o.events.find((e) => e.toStatus === s)?.createdAt ?? null;
  const received = at("pending_pharmacist") ?? o.createdAt;
  const outStatus: OrderStatus = o.fulfillment === "delivery" ? "out_for_delivery" : "ready_for_pickup";
  const rank: Record<OrderStatus, number> = { pending_pharmacist: 0, confirmed: 1, out_for_delivery: 2, ready_for_pickup: 2, delivered: 3, canceled: -1, rejected: -1 };
  const reached = (s: OrderStatus) => (o.status === "canceled" || o.status === "rejected" ? !!at(s) : rank[o.status] >= rank[s]);
  const steps = [
    { key: "received", label: "Pedido recebido", at: received.toISOString(), done: true },
    { key: "confirmed", label: "Confirmado", at: at("confirmed")?.toISOString() ?? null, done: reached("confirmed") },
    { key: "out", label: o.fulfillment === "delivery" ? "Saiu para entrega" : "Pronto para retirada", at: at(outStatus)?.toISOString() ?? null, done: reached(outStatus) },
    { key: "delivered", label: o.fulfillment === "delivery" ? "Entregue" : "Retirado", at: at("delivered")?.toISOString() ?? null, done: reached("delivered") },
  ];
  const closedAt = o.status === "canceled" ? (o.canceledAt ?? at("canceled")) : at("rejected");
  const addr = o.fulfillment === "delivery" ? (o.addressSnapshot as SnapshotAddress | null) : null;
  return {
    code: o.code,
    status: o.status,
    statusLabel: ORDER_STATUS_LABEL[o.status],
    fulfillment: o.fulfillment,
    steps,
    canceled: o.status === "canceled" || o.status === "rejected" ? { reason: o.statusReason, at: (closedAt ?? o.updatedAt).toISOString() } : null,
    items: o.items.map((i) => ({ name: i.nameSnapshot, qty: i.qty, unitPriceCents: i.unitPriceCents })),
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    paymentLabel: o.fulfillment === "pickup" ? "Pagamento na retirada" : "Pagamento na entrega",
    addressLabel: addr ? publicAddressLabel(addr) : null,
    pharmacy: { name: o.business.name, phone: o.pharmacyPhone, logoUrl: o.business.logoUrl, branding: o.branding },
    updatedAt: o.updatedAt.toISOString(),
  };
}

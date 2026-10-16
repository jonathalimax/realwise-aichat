// Order status machine (docs/pharmacy/API.md 2.1). Pure: no Nest, no DB.

import type { OrderStatus } from "../pharmacy-common/labels";

export type OrderAction = "confirm" | "out" | "done" | "cancel";
export type Fulfillment = "delivery" | "pickup";

export const ORDER_ACTIONS: readonly OrderAction[] = ["confirm", "out", "done", "cancel"];

const TERMINAL: OrderStatus[] = ["delivered", "canceled", "rejected"];
export const isClosed = (s: OrderStatus) => TERMINAL.includes(s);

/** Next status for an action, or null when the transition is not allowed from `from`. */
export function nextStatus(from: OrderStatus, action: OrderAction, fulfillment: Fulfillment): OrderStatus | null {
  switch (action) {
    case "confirm":
      return from === "pending_pharmacist" ? "confirmed" : null;
    case "out":
      return from === "confirmed" ? (fulfillment === "delivery" ? "out_for_delivery" : "ready_for_pickup") : null;
    case "done":
      return from === "out_for_delivery" || from === "ready_for_pickup" ? "delivered" : null;
    case "cancel":
      return from === "pending_pharmacist" || from === "confirmed" ? "canceled" : null;
  }
}

/** Actions the status machine allows from this state (before roles and prescriptions). */
export function machineActions(from: OrderStatus, fulfillment: Fulfillment): OrderAction[] {
  return ORDER_ACTIONS.filter((a) => nextStatus(from, a, fulfillment) !== null);
}

export interface ActionContext {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** At least one prescription is still pending (or was rejected): the order cannot be confirmed. */
  rxPending: boolean;
  courierMemberId: string | null;
}
export interface ActorContext {
  memberId: string;
  /** Courier role: only touches orders assigned to them, and only out / done. */
  ownDeliveriesOnly: boolean;
}

const COURIER_ACTIONS: OrderAction[] = ["out", "done"];

/** What the UI may offer to this actor right now (server computed, mirrors enforcement). */
export function allowedActions(ctx: ActionContext, actor: ActorContext): OrderAction[] {
  let actions = machineActions(ctx.status, ctx.fulfillment);
  if (ctx.rxPending) actions = actions.filter((a) => a !== "confirm");
  if (actor.ownDeliveriesOnly) {
    if (ctx.courierMemberId !== actor.memberId) return [];
    actions = actions.filter((a) => COURIER_ACTIONS.includes(a));
  }
  return actions;
}

export type TransitionVerdict =
  | { ok: true; to: OrderStatus }
  | { ok: false; code: "INVALID_TRANSITION"; allowed: OrderAction[] }
  | { ok: false; code: "RX_PENDING" }
  | { ok: false; code: "OWN_DELIVERIES_ONLY" }
  | { ok: false; code: "COURIER_ACTION_DENIED" };

/** The single decision point used by the service for every transition. */
export function evaluateTransition(ctx: ActionContext, action: OrderAction, actor: ActorContext): TransitionVerdict {
  if (actor.ownDeliveriesOnly) {
    if (ctx.courierMemberId !== actor.memberId) return { ok: false, code: "OWN_DELIVERIES_ONLY" };
    if (!COURIER_ACTIONS.includes(action)) return { ok: false, code: "COURIER_ACTION_DENIED" };
  }
  const to = nextStatus(ctx.status, action, ctx.fulfillment);
  if (!to) return { ok: false, code: "INVALID_TRANSITION", allowed: allowedActions(ctx, actor) };
  if (action === "confirm" && ctx.rxPending) return { ok: false, code: "RX_PENDING" };
  return { ok: true, to };
}

export const STATUS_EVENT_LABEL: Record<OrderStatus, string> = {
  pending_pharmacist: "Recebido",
  confirmed: "Confirmado",
  out_for_delivery: "Saiu para entrega",
  ready_for_pickup: "Pronto para retirada",
  delivered: "Entregue",
  canceled: "Cancelado",
  rejected: "Recusado",
};

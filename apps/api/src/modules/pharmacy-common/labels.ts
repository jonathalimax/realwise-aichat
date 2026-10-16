// pt-BR label maps shared by every pharmacy DTO (docs/pharmacy/API.md section 2).

export type SaleClass = "unclassified" | "otc" | "prescription" | "controlled";
export type Badge = "green" | "amber" | "gray" | "red" | "blue" | "soft";

export const CLASS_BADGE: Record<SaleClass, Badge> = {
  otc: "green",
  prescription: "amber",
  controlled: "gray",
  unclassified: "red",
};

const CLASS_LABEL: Record<SaleClass, string> = {
  otc: "Venda livre",
  prescription: "Receita",
  controlled: "Controlado",
  unclassified: "Sem classe",
};

/** "Venda livre ✓" when confirmed; proposed-only shows no check. */
export function classLabel(saleClass: SaleClass, confirmed: boolean): string {
  const base = CLASS_LABEL[saleClass];
  return confirmed && saleClass !== "unclassified" ? `${base} ✓` : base;
}
export function classLabelPlain(saleClass: SaleClass): string {
  return CLASS_LABEL[saleClass];
}

export function classWarning(saleClass: SaleClass): string {
  switch (saleClass) {
    case "prescription":
      return "Exige receita. O pedido sempre passa pelo farmacêutico.";
    case "controlled":
      return "Controlado. O chat só informa disponibilidade e preço, nunca vende.";
    case "unclassified":
      return "Sem classe. Não pode ser vendido no chat até ser revisado.";
    case "otc":
      return "";
  }
}

export type OrderStatus =
  | "pending_pharmacist"
  | "confirmed"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "delivered"
  | "canceled"
  | "rejected";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_pharmacist: "Novo",
  confirmed: "Confirmado",
  out_for_delivery: "Em entrega",
  ready_for_pickup: "Pronto p/ retirada",
  delivered: "Concluído",
  canceled: "Cancelado",
  rejected: "Recusado",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, Badge> = {
  pending_pharmacist: "blue",
  confirmed: "soft",
  out_for_delivery: "amber",
  ready_for_pickup: "amber",
  delivered: "green",
  canceled: "gray",
  rejected: "red",
};

export type OrderTab = "new" | "confirmed" | "out" | "done" | "canceled";

export const ORDER_TAB_STATUSES: Record<OrderTab, OrderStatus[]> = {
  new: ["pending_pharmacist"],
  confirmed: ["confirmed"],
  out: ["out_for_delivery", "ready_for_pickup"],
  done: ["delivered"],
  canceled: ["canceled", "rejected"],
};

export function orderTab(status: OrderStatus): OrderTab {
  for (const tab of Object.keys(ORDER_TAB_STATUSES) as OrderTab[]) {
    if (ORDER_TAB_STATUSES[tab].includes(status)) return tab;
  }
  return "new";
}

export const RX_STATUS_LABEL = { pending: "Aguardando", approved: "Aprovada", rejected: "Recusada" } as const;
export const RX_STATUS_BADGE = { pending: "amber", approved: "green", rejected: "red" } as const;

export const HANDOFF_REASON_LABEL = {
  symptom: "Sintoma",
  controlled: "Medicamento controlado",
  out_of_stock: "Sem estoque",
  rx: "Receita",
  product_request: "Pedido de produto",
  general_question: "Pergunta ao atendimento",
  other: "Outro",
} as const;

export function handoffTag(reason: keyof typeof HANDOFF_REASON_LABEL, urgent: boolean): { tag: string; tagBadge: Badge } {
  if (urgent) return { tag: "Urgente", tagBadge: "red" };
  if (reason === "controlled") return { tag: "Controlado", tagBadge: "gray" };
  if (reason === "out_of_stock") return { tag: "Sem estoque", tagBadge: "amber" };
  if (reason === "general_question") return { tag: "Pergunta", tagBadge: "blue" };
  return { tag: HANDOFF_REASON_LABEL[reason], tagBadge: "soft" };
}

export const MEMBER_STATUS_LABEL = { active: "Ativo", invited: "Convite pendente", disabled: "Desativado" } as const;

export const CANCEL_REASONS = [
  { code: "out_of_stock", label: "Sem estoque" },
  { code: "outside_area", label: "Endereço fora da área de entrega" },
  { code: "customer_request", label: "Cliente pediu o cancelamento" },
  { code: "other", label: "Outro motivo" },
] as const;
export type CancelReasonCode = (typeof CANCEL_REASONS)[number]["code"];

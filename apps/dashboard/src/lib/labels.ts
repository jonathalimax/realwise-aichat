// pt-BR label maps for the pharmacy enums (docs/pharmacy/API.md section 2). Shared by every pharmacy screen.
import type { BadgeVariant } from "../components/ui/badge";

export const CLASS_LABELS = {
  otc: { label: "Venda livre", badge: "green" },
  prescription: { label: "Receita", badge: "amber" },
  controlled: { label: "Controlado", badge: "gray" },
  unclassified: { label: "Sem classe", badge: "red" },
} as const satisfies Record<string, { label: string; badge: BadgeVariant }>;

export const ORDER_TABS = [
  { value: "new", label: "Novos" },
  { value: "confirmed", label: "Confirmados" },
  { value: "out", label: "Em entrega" },
  { value: "done", label: "Concluídos" },
  { value: "canceled", label: "Cancelados" },
] as const;

export const CANCEL_REASONS = [
  { code: "out_of_stock", label: "Sem estoque" },
  { code: "outside_area", label: "Endereço fora da área de entrega" },
  { code: "customer_request", label: "Cliente pediu o cancelamento" },
  { code: "other", label: "Outro motivo" },
] as const;

export const RX_REJECT_REASONS = ["Receita ilegível", "Receita vencida", "Medicamento não confere", "Falta carimbo ou CRM"] as const;

export const IMPORT_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  price: "Preço",
  stock: "Estoque",
  ean: "EAN",
  sku: "Código interno (SKU)",
  activeIngredient: "Princípio ativo",
  presentation: "Apresentação",
  manufacturer: "Fabricante",
  category: "Categoria",
  class: "Classe",
  equivalentGroup: "Grupo de equivalentes",
  ignore: "Ignorar",
};

export const CONFIDENCE_LABELS = {
  high: { label: "Alta", badge: "green" },
  medium: { label: "Média", badge: "amber" },
  low: { label: "Baixa", badge: "red" },
} as const;

export const MEMBER_STATUS_BADGE = { active: "green", invited: "amber", disabled: "gray" } as const;
export const MEMBER_STATUS_LABEL = { active: "Ativo", invited: "Convite pendente", disabled: "Desativado" } as const;

export const LOG_CATEGORY_BADGE: Record<string, BadgeVariant> = {
  Receita: "green",
  Atendimento: "amber",
  Pedido: "blue",
  Equipe: "blue",
  "Catálogo": "gray",
  "Configurações": "amber",
  Plano: "gray",
  Acesso: "outline",
  Outros: "outline",
};

export const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
] as const;

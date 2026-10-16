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

/** pt-BR text for every access-log action code the API can write (AccessLogService.record). */
export const ACCESS_LOG_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Entrou no painel",
  "auth.login_failed": "Tentativa de acesso sem sucesso",
  "auth.credentials_set": "Definiu e-mail e senha de acesso",
  "team.invite": "Convidou uma pessoa para a equipe",
  "team.invite_resend": "Reenviou um convite",
  "team.invite_accept": "Aceitou o convite",
  "team.role_change": "Alterou a função de uma pessoa",
  "team.disable": "Desativou uma pessoa",
  "team.enable": "Reativou uma pessoa",
  "team.remove": "Removeu uma pessoa ou convite",
  "role.create": "Criou uma função",
  "role.update": "Atualizou uma função",
  "role.delete": "Removeu uma função",
  "prescription.approve": "Aprovou uma receita",
  "prescription.reject": "Recusou uma receita",
  "prescription.download": "Abriu o arquivo de uma receita",
  "handoff.start": "Iniciou um atendimento",
  "handoff.answer": "Respondeu um atendimento",
  "handoff.close": "Encerrou um atendimento",
  "handoff.whatsapp_link": "Abriu o contato por WhatsApp",
  "handoff.whatsapp_answer": "Marcou atendimento como respondido (WhatsApp)",
  "class.confirm": "Confirmou a classe de medicamentos",
  "catalog.import": "Importou o catálogo",
  "catalog.product_update": "Atualizou um produto",
  "order.confirm": "Confirmou um pedido",
  "order.out": "Enviou um pedido para entrega",
  "order.done": "Concluiu um pedido",
  "order.cancel": "Cancelou um pedido",
  "order.assign_courier": "Atribuiu um entregador",
  "settings.update": "Atualizou as configurações",
  "branding.update": "Atualizou a identidade visual",
  "billing.change": "Alterou o plano",
};

/** Friendly sentence for a log row: the API summary when it is real text, else the action label, else the raw code. */
export function accessLogDetail(l: { action: string; summary?: string | null; target?: string | null }): string {
  const s = (l.summary ?? "").trim();
  if (s && s !== l.action) return s;
  const label = ACCESS_LOG_ACTION_LABELS[l.action];
  if (label) return l.target ? `${label}: ${l.target}` : label;
  return l.action;
}

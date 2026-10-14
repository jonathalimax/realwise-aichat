// Pharmacy ATTENDANCE mode (operation mode "attendance", see packages/shared/src/pharmacy-mode.ts):
// the pharmacy only uses Alex as an AI attendant with escalation to the pharmacist, like a WhatsApp
// with AI. No catalog, no stock, no cart, no orders, no prescription upload. Alex NEVER claims to
// know stock or price: "do you have X?" is collected as free text and handed to the pharmacist
// (PharmacistHandoff reason `product_request`). Pure text helpers + fixed copy; the lane itself
// lives in pharmacy-chat.service.ts. Nothing in this file touches the database.

import { CHIPS } from "./copy";
import { fold, productTokens } from "./text";

export const ATT_CHIPS = {
  askProduct: "Perguntar sobre um produto",
  talkPharmacist: CHIPS.talkPharmacist,
  hoursDelivery: CHIPS.hoursDelivery,
  confirmRequest: "Sim, pode registrar",
} as const;

/** Chips that only make sense with a catalog/cart; replaced or dropped in attendance mode. */
const COMMERCE_CHIPS = new Set(
  [
    CHIPS.addToCart,
    CHIPS.checkout,
    CHIPS.addMore,
    CHIPS.viewCart,
    CHIPS.changeItems,
    CHIPS.clearCart,
    CHIPS.confirmOrder,
    CHIPS.delivery,
    CHIPS.pickup,
    CHIPS.uploadedRx,
    "Acompanhar pedido",
    "Ver outro produto",
    "Continuar comprando",
  ].map(fold),
);

export function attendanceChips(chips: string[] | undefined): string[] | undefined {
  if (!chips) return chips;
  const out: string[] = [];
  for (const chip of chips) {
    const f = fold(chip);
    if (f === fold(CHIPS.makeOrder)) {
      if (!out.includes(ATT_CHIPS.askProduct)) out.push(ATT_CHIPS.askProduct);
      continue;
    }
    if (COMMERCE_CHIPS.has(f)) continue;
    out.push(chip);
  }
  return out.length > 0 ? out : undefined;
}

/** Default welcome chips of an attendance-mode pharmacy (also used by the widget). */
export const ATTENDANCE_WELCOME_CHIPS = [ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery, ATT_CHIPS.askProduct];

export const ATT_COPY = {
  welcome: (businessName: string) =>
    `Oi! Sou o Alex, assistente virtual com inteligência artificial da ${businessName}. Posso responder dúvidas sobre horários, entrega e retirada, e encaminhar sua pergunta ao farmacêutico. Não indico remédios.`,
  askProduct:
    "Claro! Eu não consulto estoque nem preço por aqui: quem confirma a disponibilidade e o valor é o farmacêutico. Me diga o que você procura (nome do produto e quantidade) e eu repasso para ele.",
  confirmRequest:
    "Entendi. Eu não consulto estoque nem preço por aqui: quem confirma a disponibilidade e o valor é o farmacêutico, e ele responde nesta conversa. Posso registrar o que você pediu e passar a ele? (Guardo só o que você escreveu, para este atendimento, conforme a LGPD.)",
  retryConfirm: "Para encaminhar ao farmacêutico preciso da sua concordância. Posso registrar o que você me contou?",
  declined: "Tudo bem, não registrei nada. Se mudar de ideia, é só me dizer o que você procura.",
  done:
    "Pronto, passei seu pedido ao farmacêutico. Ele vai confirmar se tem o produto e o valor, e responde por aqui em instantes.",
  followUp: "Anotei e já avisei o farmacêutico. Ele responde por aqui.",
  orderStatus:
    "Eu não acompanho pedidos por aqui. Posso avisar o farmacêutico para falar com você sobre isso.",
  cartAction:
    "Esta farmácia atende pelo chat sem carrinho: o farmacêutico confirma disponibilidade e valor. Me diga o que você procura e eu repasso a ele.",
} as const;

const ASK_WORDS =
  /\b(tem|temos|teria|tinha|vendem|vende|trabalham com|trabalha com|possuem|possui|disponivel|disponiveis|disponibilidade|estoque|preco|precos|valor|valores|quanto|custa|custam|sai|fica|comprar|compra|pedir|pedido|encomendar|encomenda|reservar|reserva|separar|quero|queria|preciso|precisava|gostaria|me ve|me manda|manda|vou querer|levar|leva|chegou|chegaram)\b/;

const INFO_WORDS = new Set([
  "horario", "horarios", "funciona", "funcionamento", "abre", "aberto", "aberta", "fecha", "fechado", "fechada", "abertos", "hoje", "agora", "amanha", "sabado", "domingo", "feriado", "feriados",
  "entrega", "entregam", "entregas", "frete", "taxa", "delivery", "motoboy", "bairro", "bairros", "retirada", "retirar", "retiro", "pagamento", "pagar", "pix", "cartao", "dinheiro", "forma", "formas",
  "troca", "trocar", "devolucao", "devolver", "farmacia", "voces", "atendem", "atende", "atendimento", "remedio", "remedios", "produto", "produtos", "medicamento", "medicamentos", "algo", "coisa",
  "gente", "pessoal", "ola", "oi", "bom", "boa", "dia", "tarde", "noite", "tudo", "bem", "obrigado", "obrigada", "pode", "poderia", "saber", "informacao", "informacoes", "queria", "ate", "que", "horas", "minimo", "maximo",
]);

/** True when the sentence names something (a product) beyond question/filler/info words. */
export function hasProductMention(text: string): boolean {
  return productTokens(text).some((tok) => tok.length >= 3 && !/^\d+$/.test(tok) && !INFO_WORDS.has(tok));
}

/** "tem X?", "quanto custa X", "quero X", "quero fazer um pedido": anything that is a product/price/availability question. */
export function asksAboutProduct(text: string): boolean {
  const f = fold(text);
  return ASK_WORDS.test(f) || f === fold(CHIPS.makeOrder) || f === fold(ATT_CHIPS.askProduct);
}

/** Intent of the "do you have X" kind without any product named yet ("quero fazer um pedido", "queria um remédio"). */
export function isBareProductIntent(text: string): boolean {
  return asksAboutProduct(text) && !hasProductMention(text);
}

/** Commerce-only structured actions of the widget: refused (politely) in attendance mode. */
export const COMMERCE_ACTIONS = new Set([
  "catalog.browse",
  "product.view",
  "cart.add",
  "cart.set_qty",
  "cart.remove",
  "cart.view",
  "cart.clear",
  "rx.check",
  "checkout.start",
  "checkout.contact",
  "checkout.fulfillment",
  "checkout.use_saved_address",
  "checkout.address",
  "checkout.confirm",
]);

export function buildProductRequestBrief(requestText: string, conversationLink: string): Record<string, unknown> {
  const text = requestText.replace(/\s+/g, " ").trim().slice(0, 500);
  return {
    // The pharmacist's panel shows "Produto pedido" and "Pedido do cliente"; both are the customer's own words.
    requestedProduct: text,
    customerRequest: text,
    availability: "A confirmar pelo farmacêutico (Alex não consulta estoque nem preço)",
    conversationLink,
  };
}

/** Mode-aware text of the settings facts that otherwise talk about "pedido". */
export function attendancePickupLine(pickupEnabled: boolean): string {
  return pickupEnabled ? "A farmácia tem retirada em loja." : "A retirada em loja não está disponível no momento.";
}

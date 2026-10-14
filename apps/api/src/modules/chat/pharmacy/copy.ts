// All customer-facing pharmacy copy (pt-BR, persona Alex). Fixed strings: the model never writes
// safety- or money-relevant text. No product names, doses or recommendations in lane E copy.

import type { ConsentCard } from "./types";

export const CONSENT_VERSION = "2026-10";

export const CONSENT_TEXTS: Record<string, string> = {
  pharmacy_triage:
    "Para encaminhar você ao farmacêutico, vou registrar o que você me contar sobre sua saúde (sintomas, alergias, outros medicamentos). São dados sensíveis (LGPD): ficam acessíveis só à equipe da farmácia, são usados apenas neste atendimento e podem ser apagados a seu pedido.",
  prescription_upload:
    "Autorizo o envio da foto da minha receita para validação pelo farmacêutico (LGPD). A imagem fica guardada com acesso restrito à equipe da farmácia e é apagada depois do prazo de retenção.",
  pharmacy_contact:
    "Autorizo o farmacêutico a me chamar no WhatsApp informado, só para continuar este atendimento (LGPD). O número fica guardado com acesso restrito à equipe da farmácia e pode ser apagado a seu pedido.",
  order_contact:
    "Vou guardar seu nome, telefone, e-mail e endereço só para entregar e acompanhar este pedido e avisar você sobre ele (LGPD). Você pode pedir a exclusão a qualquer momento.",
};

export function consentCard(purpose: "pharmacy_triage" | "prescription_upload" | "order_contact" | "pharmacy_contact"): ConsentCard {
  return { purpose, version: CONSENT_VERSION, text: CONSENT_TEXTS[purpose], required: true };
}

export const CHIPS = {
  makeOrder: "Fazer um pedido",
  talkPharmacist: "Falar com o farmacêutico",
  hoursDelivery: "Horários e entrega",
  addToCart: "Adicionar ao carrinho",
  checkout: "Finalizar pedido",
  addMore: "Adicionar outro item",
  viewCart: "Ver carrinho",
  changeItems: "Alterar itens",
  clearCart: "Esvaziar carrinho",
  confirmOrder: "Confirmar pedido",
  cancel: "Cancelar",
  delivery: "Entrega",
  pickup: "Retirada em loja",
  savedOk: "Está certo",
  savedUpdate: "Atualizar endereço",
  noComplement: "Sem complemento",
  noReference: "Sem referência",
  skipEmail: "Prefiro não informar",
  consentAgree: "Concordo",
  alertPharmacist: "Avisar o farmacêutico",
  otherAddress: "Informar outro endereço",
  onlyPharmacist: "Só chamar o farmacêutico",
  uploadedRx: "Já enviei a receita",
} as const;

export const COPY = {
  askProduct: "Claro! Qual produto você quer pedir? Me diga o nome (por exemplo: Dipirona 500 mg).",
  notFound:
    "Não encontrei esse produto no catálogo. Pode me dizer o nome de outra forma (nome e concentração)? Se preferir, chamo o farmacêutico para ajudar.",
  catalogIntro: "Estes são alguns dos nossos produtos. Toque em um para pedir, ou me diga o nome do que você procura:",
  catalogMore: "Mais produtos:",
  catalogNotFound: "Não encontrei esse produto. Veja o que temos disponível agora, ou me diga o nome de outra forma:",
  catalogEmpty: "No momento não tenho produtos para listar aqui. Me diga o nome do que você procura ou chame o farmacêutico.",
  ambiguous: "Encontrei mais de uma opção. Qual delas você quer?",
  cartEmpty: "Seu carrinho está vazio. Me diga o nome do produto que você quer pedir.",
  cartCleared: "Pronto, esvaziei o carrinho.",
  controlledInfo: "Este medicamento é controlado e não pode ser vendido online. Venha à farmácia com a receita.",
  unclassifiedInfo: "Este produto precisa de confirmação do farmacêutico e não vendemos online. Venha à farmácia ou fale com o farmacêutico.",
  pharmacistRequired: "Este produto precisa ser confirmado pelo farmacêutico antes do pedido. Posso avisá-lo para você.",
  rxNeeded: "Este medicamento exige receita. Envie uma foto nítida da receita para o farmacêutico validar; o pedido só é confirmado depois disso.",
  rxReceived: "Recebi sua receita. O farmacêutico vai validar antes de confirmar o pedido.",
  noSale: "Não posso fechar esse pedido por aqui. Posso chamar o farmacêutico para ajudar.",
  dosageRefusal:
    "Não posso orientar sobre dose, horários ou como usar medicamentos. Quem orienta isso é o farmacêutico — posso chamá-lo para você.",
  handoffDone: "Passei suas informações ao farmacêutico. Ele responde por aqui em instantes.",
  handoffAdded: "Recebi sua mensagem e já avisei o farmacêutico. Ele responde por aqui.",
  handoffOtherDone: "Avisei o farmacêutico. Ele responde por aqui em instantes.",
  redFlagCooldown:
    "Antes de qualquer pedido: se a situação que você descreveu é urgente, ligue 192 (SAMU) ou vá ao pronto-socorro. Se estiver tudo bem, posso chamar o farmacêutico para seguir com você.",
  symptomIntro:
    "Entendi. Não posso indicar remédios, mas vou reunir algumas informações para o farmacêutico te responder por aqui.",
  symptomConsentAsk: "Posso registrar o que você me contar?",
  symptomConsentRetry: "Para seguir com as perguntas preciso da sua concordância. Posso registrar o que você me contar?",
  symptomAskPhone:
    "Qual seu WhatsApp (com DDD) para o farmacêutico te chamar? Se preferir, ele responde só por aqui no chat. Ao informar o número você autoriza esse contato (LGPD).",
  symptomAskName: "Como posso te chamar? É opcional.",
  handoffDoneWhatsapp: "Passei suas informações ao farmacêutico. Ele responde por aqui ou te chama no WhatsApp em instantes.",
  askPhone: "Para finalizar, qual o seu WhatsApp (com DDD)?",
  badPhone: "Não consegui entender esse número. Pode enviar com DDD, por exemplo (41) 99999-9999?",
  askName: "Qual o seu nome?",
  askEmail: "E o seu e-mail? Uso só para enviar o acompanhamento do pedido.",
  badEmail: "Esse e-mail não parece válido. Pode conferir? Se preferir, toque em \"Prefiro não informar\".",
  askContactConsent: "Posso guardar esses dados para entregar e acompanhar o pedido?",
  askFulfillment: "Como prefere receber?",
  askCep: "Qual o CEP do endereço de entrega?",
  badCep: "Esse CEP não parece válido. Envie os 8 números, por exemplo 80250-000.",
  cepNotFound: "Não encontrei esse CEP. Pode conferir os números?",
  cepUnavailable:
    "Não consegui consultar o CEP agora. Me diga rua, bairro e cidade/UF, por exemplo: Rua das Flores, Água Verde, Curitiba/PR.",
  askStreetOnly: "Esse CEP é geral da cidade. Qual o nome da rua?",
  badManualAddress: "Preciso de rua, bairro e cidade/UF, separados por vírgula. Por exemplo: Rua das Flores, Água Verde, Curitiba/PR.",
  askNumber: "Qual o número? Use só números, 12B ou \"sem número\".",
  askComplement: "Tem complemento (apartamento, bloco)? É opcional.",
  askReference: "Quer deixar um ponto de referência? É opcional.",
  outsideArea:
    "Esse endereço fica fora da área de entrega da farmácia. Você pode retirar na loja, informar outro endereço ou falar com o farmacêutico.",
  deliveryUnavailable: "A farmácia não está fazendo entregas no momento. Posso seguir com a retirada na loja.",
  pickupUnavailable: "A farmácia não está com retirada em loja no momento. Posso seguir com a entrega.",
  staleStockNotice:
    "O estoque que tenho aqui pode estar desatualizado. A farmácia confirma a disponibilidade antes de confirmar seu pedido.",
  rxReviewNotice: "Pedidos com receita passam pela validação do farmacêutico antes de serem confirmados.",
  closedNotice: "A farmácia está fechada agora; seu pedido será atendido assim que abrir.",
  orderChanged: "Alguns itens do seu carrinho mudaram e não puderam ser mantidos. Confira o carrinho e me diga se quer continuar.",
  genericError: "Não consegui concluir essa etapa agora. Posso chamar o farmacêutico para ajudar.",
  noOrderYet: "Ainda não encontrei nenhum pedido seu por aqui. Quer fazer um pedido?",
  unknownInfo: "Essa informação eu vou confirmar com a equipe para não te passar nada errado. Quer falar com o farmacêutico?",
};

export function paymentPhrase(methods: string[], fulfillment: "delivery" | "pickup"): string {
  const label: Record<string, string> = { pix: "Pix", cartao: "cartão", dinheiro: "dinheiro" };
  const list = methods.map((m) => label[m] ?? m);
  const when = fulfillment === "delivery" ? "na entrega" : "na retirada";
  return list.length > 0 ? `Pagamento ${when} (${list.join("/")}, conforme a farmácia)` : `Pagamento ${when}`;
}

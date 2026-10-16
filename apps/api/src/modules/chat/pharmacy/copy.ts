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
  consentAgree: "Concordo e quero continuar",
  talkAttendant: "Falar com atendente",
  otherProducts: "Ver outros produtos",
  alertPharmacist: "Avisar o farmacêutico",
  otherAddress: "Informar outro endereço",
  onlyPharmacist: "Só chamar o farmacêutico",
  uploadedRx: "Já enviei a receita",
} as const;

export const COPY = {
  askProduct: "Claro, com prazer! Qual produto você quer pedir? Me diga o nome (por exemplo: Dipirona 500 mg) que eu separo para você.",
  notFound:
    "Poxa, não encontrei esse produto no catálogo. Pode me dizer o nome de outra forma (nome e concentração)? Se preferir, chamo o farmacêutico para ajudar.",
  catalogIntro: "Olha o que temos por aqui. Toque em um para pedir, ou me diga o nome do que você procura:",
  catalogMore: "Mais produtos:",
  catalogNotFound: "Não achei esse produto, mas veja o que temos disponível agora, ou me diga o nome de outra forma:",
  catalogEmpty: "No momento não tenho produtos para listar aqui. Me diga o nome do que você procura ou chame o farmacêutico.",
  ambiguous: "Encontrei mais de uma opção. Qual delas você quer?",
  cartEmpty: "Seu carrinho está vazio por enquanto. Me diga o nome do produto que você quer e eu coloco para você.",
  notInCart: "Esse item não está no seu carrinho.",
  cartCleared: "Pronto, esvaziei o carrinho. Quando quiser recomeçar, é só me dizer.",
  controlledInfo: "Entendo a necessidade. Este medicamento é controlado e não pode ser vendido online; venha à farmácia com a receita que a equipe te atende.",
  unclassifiedInfo: "Este produto precisa de confirmação do farmacêutico e não vendemos online. Venha à farmácia ou fale com o farmacêutico.",
  pharmacistRequired: "Este produto precisa ser confirmado pelo farmacêutico antes do pedido. Posso avisá-lo para você.",
  rxNeeded: "Este medicamento exige receita. Pode me enviar uma foto nítida dela? O farmacêutico valida e só então o pedido é confirmado.",
  rxReceived: "Recebi sua receita, obrigado! O farmacêutico vai validar antes de confirmar o pedido.",
  noSale: "Esse pedido eu não consigo fechar por aqui, mas o farmacêutico pode ajudar você. Quer que eu chame?",
  dosageRefusal:
    "Quero que você use tudo com segurança, por isso dose, horários e modo de uso quem orienta é o farmacêutico. Posso chamá-lo para você agora.",
  handoffDone: "Obrigado por me contar. Já passei tudo ao farmacêutico; assim que ele responder, aparece aqui na conversa.",
  handoffAdded: "Anotei, obrigado! Já avisei o farmacêutico, e a resposta vem por aqui.",
  handoffOtherDone: "Pronto, já avisei o farmacêutico. Assim que ele responder, te mostro aqui.",
  redFlagCooldown:
    "Me preocupo com você: se a situação que descreveu é urgente, ligue 192 (SAMU) ou vá ao pronto-socorro agora. Se estiver tudo bem, posso chamar o farmacêutico para seguir com você.",
  symptomIntro:
    "Sinto muito que você esteja passando por isso, vamos cuidar disso juntos. Eu não posso indicar remédios, mas vou reunir algumas informações para o farmacêutico te responder por aqui.",
  symptomConsentAsk: "Posso anotar o que você me contar para ajudar o farmacêutico?",
  symptomConsentRetry: "Sem problema, é você quem decide. Para seguir com as perguntas preciso da sua concordância. Posso anotar o que você me contar?",
  symptomAskPhone:
    "Quer que o farmacêutico também te chame no WhatsApp? Me passe o número com DDD. Se preferir, ele responde só por aqui no chat. Ao informar o número você autoriza esse contato (LGPD).",
  symptomAskName: "Como posso te chamar? Assim a conversa fica mais pessoal (é opcional).",
  handoffDoneWhatsapp: "Obrigado por me contar. Já passei tudo ao farmacêutico; ele responde por aqui ou te chama no WhatsApp assim que puder.",
  askPhone: "Vamos finalizar! Qual o seu WhatsApp (com DDD)?",
  badPhone: "Acho que esse número não ficou completo. Pode enviar com DDD, por exemplo (41) 99999-9999?",
  askName: "Qual o seu nome? Gosto de saber com quem estou falando.",
  askEmail: "Se quiser, me passe seu e-mail para eu enviar o acompanhamento do pedido (é opcional).",
  badEmail: "Acho que o e-mail tem algum errinho. Pode conferir? Se preferir, toque em \"Prefiro não informar\".",
  askContactConsent: "Posso guardar esses dados só para entregar e acompanhar o seu pedido?",
  askFulfillment: "Como fica melhor para você receber?",
  askCep: "Qual o CEP do endereço de entrega? Assim eu já encontro a sua rua.",
  badCep: "Esse CEP parece incompleto. Pode enviar os 8 números, por exemplo 80250-000?",
  cepNotFound: "Não encontrei esse CEP aqui. Pode conferir os números para mim?",
  cepUnavailable:
    "Não consegui consultar o CEP agora. Me diga rua, bairro e cidade/UF, por exemplo: Rua das Flores, Água Verde, Curitiba/PR.",
  askStreetOnly: "Esse CEP é geral da cidade. Qual o nome da rua?",
  badManualAddress: "Preciso de rua, bairro e cidade/UF, separados por vírgula. Por exemplo: Rua das Flores, Água Verde, Curitiba/PR.",
  askNumber: "Qual o número? Use só números, 12B ou \"sem número\".",
  askComplement: "Tem complemento (apartamento, bloco)? É opcional.",
  askReference: "Quer deixar um ponto de referência? É opcional.",
  outsideArea:
    "Que pena, esse endereço fica fora da nossa área de entrega. Você pode retirar na loja, informar outro endereço ou falar com o farmacêutico.",
  deliveryUnavailable: "No momento a farmácia não está fazendo entregas, mas posso seguir com a retirada na loja para você.",
  pickupUnavailable: "A farmácia não está com retirada em loja no momento. Posso seguir com a entrega.",
  staleStockNotice:
    "O estoque que tenho aqui pode estar desatualizado. A farmácia confirma a disponibilidade antes de confirmar seu pedido.",
  rxReviewNotice: "Pedidos com receita passam pela validação do farmacêutico antes de serem confirmados.",
  closedNotice: "A farmácia está fechada agora, mas seu pedido já fica registrado e é atendido assim que abrirmos.",
  orderChanged: "Alguns itens do seu carrinho mudaram e não puderam ser mantidos. Confira o carrinho e me diga se quer continuar.",
  genericError: "Desculpe, não consegui concluir essa etapa agora. Pode tentar de novo? Se preferir, chamo o farmacêutico para ajudar.",
  noOrderYet: "Ainda não encontrei nenhum pedido seu por aqui. Quer que eu monte um agora?",
  unknownInfo: "Quero te passar a informação certinha, então vou confirmar com a equipe. Quer falar com o farmacêutico enquanto isso?",
  // A non-clinical question Alex cannot answer from settings/KB/profile: the staff answers (general_question handoff).
  generalQuestionAck: "Boa pergunta! Ainda não tenho essa informação, mas já pedi para a equipe da farmácia confirmar, e a resposta aparece aqui mesmo.",
  generalQuestionAckAgain: (first: string | null | undefined) => `Anotei essa também${first ? `, ${first}` : ""}! A equipe responde aqui mesmo no chat.`,
  generalQuestionAskPhone:
    "Quer que eu avise você no WhatsApp quando a equipe responder? É só me passar o número com DDD. Se preferir, a resposta chega só aqui no chat.",
  attendantAsk: "Claro! Qual é a sua dúvida? Se eu não souber, passo para a equipe da farmácia responder por aqui.",
  consentDeclined:
    "Tudo bem, respeito a sua decisão. Sem a concordância eu não consigo guardar seus dados para registrar o pedido por aqui, mas você pode concordar para seguir com a entrega ou a retirada, falar com o farmacêutico ou passar na farmácia.",
  whichProduct: (first: string | null | undefined) => `Claro${first ? `, ${first}` : ""}! Qual remédio ou produto você está procurando? Se preferir me contar o que está sentindo, eu chamo o farmacêutico para te ajudar.`,
  medQuestionIntro: (first: string | null | undefined) => `Boa pergunta${first ? `, ${first}` : ""}! Essa orientação é do farmacêutico, e eu deixo tudo anotado para ele te responder por aqui, com segurança.`,
  offTopic: (first: string | null | undefined) => `Essa eu deixo passar${first ? `, ${first}` : ""} 😄 Por aqui eu ajudo com a farmácia: pedidos, entrega, horários, ou chamo o farmacêutico para você.`,
  unclear: (first: string | null | undefined) => `Quero te ajudar direitinho${first ? `, ${first}` : ""}, mas não entendi bem. Me conta o nome do produto ou o que você precisa? Se preferir, chamo o farmacêutico.`,
  directPharmacistIntro: (first: string | null | undefined, ref: string) => `Claro${first ? `, ${first}` : ""}! Vou chamar ${ref}. Para já chegar sabendo do seu caso, eu deixo tudo anotado.`,
  nicePrefix: (first: string) => `Prazer, ${first}! Como posso te ajudar hoje?`,
  /** Short warm lead before a settings-based information answer. */
  infoLead: (first: string | null | undefined) => (first ? `Claro, ${first}! Aqui está:` : "Claro! Aqui está:"),
  /** "mais um" / "tira um" when there is nothing in the cart to change. */
  nothingToEdit: (first: string | null | undefined) => `Ainda não tem nada no carrinho${first ? `, ${first}` : ""}. Me diga qual produto você quer (ou toque numa das opções) e eu coloco para você.`,
  suggestionIntro: "Que bom! Vou separar o que o farmacêutico indicou para você:",
};

export function paymentPhrase(methods: string[], fulfillment: "delivery" | "pickup"): string {
  const label: Record<string, string> = { pix: "Pix", cartao: "cartão", dinheiro: "dinheiro" };
  const list = methods.map((m) => label[m] ?? m);
  const when = fulfillment === "delivery" ? "na entrega" : "na retirada";
  return list.length > 0 ? `Pagamento ${when} (${list.join("/")})` : `Pagamento ${when}`;
}

/** "Aceitamos Pix, cartão e dinheiro" for the information answers (a direct answer to "aceitam pix?"). */
export function acceptedPaymentPhrase(methods: string[]): string {
  const label: Record<string, string> = { pix: "Pix", cartao: "cartão", dinheiro: "dinheiro" };
  const list = methods.map((m) => label[m] ?? m);
  if (list.length === 0) return "O pagamento é feito na entrega ou na retirada";
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
  return `Aceitamos ${joined}`;
}

/** "a Dra. Carla" / "o Dr. João" / "o farmacêutico": how Alex refers to the responsible pharmacist in warm lines. */
export function pharmacistRef(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  const m = n.match(/^(Dra?\.?)\s+(\S+)/i);
  if (!m) return "o farmacêutico";
  const title = /^dra/i.test(m[1]) ? "Dra." : "Dr.";
  return `${title === "Dra." ? "a" : "o"} ${title} ${m[2]}`;
}

/** Empty or ", Maria" so a warm line can address the customer by first name once it is known. */
export function nameComma(first: string | null | undefined): string {
  return first ? `, ${first}` : "";
}

/** The empathy line that opens the symptom lane, adapted to who the customer is worried about. */
export function symptomIntroFor(patient: "self" | "adult" | "child" | "baby"): string {
  const tail = "Eu não posso indicar remédios, mas vou reunir algumas informações para o farmacêutico te responder por aqui.";
  switch (patient) {
    case "child":
      return `Sinto muito que a criança esteja assim, vamos cuidar dela com carinho. ${tail}`;
    case "baby":
      return `Sinto muito que o bebê esteja assim, vamos cuidar dele com todo o carinho. ${tail}`;
    case "adult":
      return `Sinto muito que essa pessoa esteja passando por isso, vamos cuidar disso juntos. ${tail}`;
    default:
      return `Sinto muito que você esteja passando por isso, vamos cuidar disso juntos. ${tail}`;
  }
}

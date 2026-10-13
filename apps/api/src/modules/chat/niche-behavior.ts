import type { Niche } from "@realwise/db";

// Single, exhaustive place for every "what does this niche say / do" decision that used to be a
// scattered `niche === "concessionaria" ? … : …` (which silently treated any new niche as real
// estate). Adding a niche without an entry here is a compile error.
//
// Pharmacy (`farmacia`) entries marked TODO(wave2:chat-engine) are deliberately SAFE and NEUTRAL
// stubs: no visit scheduling, no listing cards, no financing, no recommendation of any product.
// The real pharmacy lanes (red flag, OTC cart, Rx, controlled, symptom handoff) are wave-2 work in
// the chat engine and will replace the stubs.

export type SchedulingBehavior = {
  /** Scripted flow node that opens the schedule picker. */
  dayNodeId: string;
  /** Appointment.serviceName */
  serviceName: string;
  scheduledLabel: string;
  pickerMessage: string;
  /** "uma visita" / "um test-drive" (owner emails). */
  appointmentPhrase: string;
};

export interface NicheBehavior {
  /** "um negócio de …" in the system prompt. */
  businessDescriptor: string;
  /** "Base de conhecimento geral do mercado … brasileiro". */
  sharedKnowledgeMarket: string;
  /** Which engagement-summary signals are extracted from the visitor's text. */
  engagementEvents: "real_estate" | "vehicle" | "none";
  /** Listing cards, "Selecionar", cost packages, similar/compare shortcuts, listing suggestions. */
  usesListingEngine: boolean;
  /** Assertive rent/buy triage (imobiliaria only). */
  usesRentBuyTriage: boolean;
  supportsFinancingSimulation: boolean;
  scheduling: SchedulingBehavior | null;
  humanNoun: string;
  /** "imóvel" | "carro" word used in flow detail nodes. */
  flowItemWord: string;
  selectionNoun: string;
  browseItemsPhrase: string;
  topicsPhrase: string;
  browseSuggestion: string;
  scheduleSuggestion: string | null;
  /** Word after "uma/um" in "agendar uma visita"; null when scheduling is not offered. */
  scheduleWord: string | null;
  nextStepSentence: (hasContact: boolean) => string;
  /** Tail of the degraded reply: "… posso <this>." */
  degradedOptions: string;
  vagueInterestQuestion: string;
  honestFallback: string;
  noInventory: { message: string; bubbleLabel: string };
  bookingFailureMessage: string;
  listingQueryWords: string;
}

const REAL_ESTATE: NicheBehavior = {
  businessDescriptor: "locação imobiliária",
  sharedKnowledgeMarket: "imobiliário",
  engagementEvents: "real_estate",
  usesListingEngine: true,
  usesRentBuyTriage: true,
  supportsFinancingSimulation: true,
  scheduling: {
    dayNodeId: "visita_dia",
    serviceName: "Visita ao imóvel",
    scheduledLabel: "Visita agendada",
    appointmentPhrase: "uma visita",
    pickerMessage: "Ótimo! Escolha o dia e o horário que preferir para a visita 👇 Se quiser, pode marcar mais de uma opção.",
  },
  humanNoun: "corretor",
  flowItemWord: "imóvel",
  selectionNoun: "imóvel",
  browseItemsPhrase: "os imóveis disponíveis",
  topicsPhrase: "imóveis, valores, documentação e visitas",
  browseSuggestion: "Ver imóveis disponíveis",
  scheduleSuggestion: "Agendar uma visita",
  scheduleWord: "visita",
  nextStepSentence: (hasContact) =>
    hasContact
      ? "Enquanto isso, posso agendar uma visita ou te ajudar com outra dúvida."
      : "Se quiser, já deixo agendada uma visita ou te passo pra um corretor — eles te respondem no seu WhatsApp.",
  degradedOptions: "te mostrar os imóveis disponíveis, agendar uma visita ou te passar pra um corretor",
  vagueInterestQuestion:
    "Posso te ajudar a encontrar o imóvel ideal! Pra filtrar certo: você procura pra alugar ou comprar, quantos quartos, e qual bairro ou faixa de preço tem em mente?",
  honestFallback: "Essa informação eu vou confirmar com o time pra não te passar nada errado. Quer agendar uma visita ou falar com um corretor?",
  noInventory: {
    message: "Ainda não tenho os imóveis carregados aqui — quer falar com um corretor para ver as opções disponíveis?",
    bubbleLabel: "Falar com um corretor",
  },
  bookingFailureMessage: "Não consegui confirmar esse horário automaticamente — vou te colocar em contato com um corretor para agendar manualmente.",
  listingQueryWords: "imóvel apartamento casa",
};

const VEHICLE: NicheBehavior = {
  businessDescriptor: "concessionária de veículos",
  sharedKnowledgeMarket: "de veículos",
  engagementEvents: "vehicle",
  usesListingEngine: true,
  usesRentBuyTriage: false,
  supportsFinancingSimulation: true,
  scheduling: {
    dayNodeId: "agend_dia",
    serviceName: "Test-drive",
    scheduledLabel: "Agendado",
    appointmentPhrase: "um test-drive",
    pickerMessage: "Ótimo! Escolha o dia e o horário que preferir para o test-drive 👇",
  },
  humanNoun: "vendedor",
  flowItemWord: "carro",
  selectionNoun: "veículo",
  browseItemsPhrase: "os carros disponíveis",
  topicsPhrase: "carros, valores, financiamento e test-drives",
  browseSuggestion: "Ver carros disponíveis",
  scheduleSuggestion: "Agendar um test-drive",
  scheduleWord: "test-drive",
  nextStepSentence: (hasContact) =>
    hasContact
      ? "Enquanto isso, posso agendar uma test-drive ou te ajudar com outra dúvida."
      : "Se quiser, já deixo agendada uma test-drive ou te passo pra um vendedor — eles te respondem no seu WhatsApp.",
  degradedOptions: "te mostrar os carros disponíveis, agendar uma test-drive ou te passar pra um vendedor",
  vagueInterestQuestion:
    "Posso te ajudar a encontrar o veículo ideal! Pra filtrar certo: qual modelo ou faixa de preço você tem em mente, e prefere 0km ou usado?",
  honestFallback: "Essa informação eu vou confirmar com o time pra não te passar nada errado. Quer agendar um test-drive ou falar com um vendedor?",
  noInventory: {
    message: "Ainda não tenho o estoque carregado aqui — quer falar com um vendedor para ver as opções disponíveis?",
    bubbleLabel: "Falar com um vendedor",
  },
  bookingFailureMessage: "Não consegui confirmar esse horário automaticamente — vou te colocar em contato com um vendedor para agendar manualmente.",
  listingQueryWords: "carro veículo",
};

// TODO(wave2:chat-engine): replace these neutral stubs with the real pharmacy behavior (lane router,
// product search, red-flag reply, handoff). Until then the pharmacy chat only offers: talk to the
// pharmacist, general questions answered from the profile/KB, and nothing that recommends a product.
const PHARMACY: NicheBehavior = {
  businessDescriptor: "farmácia",
  sharedKnowledgeMarket: "farmacêutico",
  engagementEvents: "none",
  usesListingEngine: false,
  usesRentBuyTriage: false,
  supportsFinancingSimulation: false,
  scheduling: null,
  humanNoun: "farmacêutico",
  flowItemWord: "produto",
  selectionNoun: "produto",
  browseItemsPhrase: "os produtos disponíveis",
  topicsPhrase: "pedidos, entrega, retirada e horários",
  browseSuggestion: "Fazer um pedido",
  scheduleSuggestion: null,
  scheduleWord: null,
  nextStepSentence: (hasContact) =>
    hasContact
      ? "Enquanto isso, posso te ajudar com outra dúvida ou chamar o farmacêutico."
      : "Se quiser, passo você para o farmacêutico — ele responde por aqui.",
  degradedOptions: "te ajudar a montar um pedido ou te passar para o farmacêutico",
  vagueInterestQuestion: "Posso ajudar! Me diga o nome do produto que você procura ou, se preferir, falo com o farmacêutico por você.",
  honestFallback: "Essa informação eu vou confirmar com a equipe para não te passar nada errado. Quer falar com o farmacêutico?",
  noInventory: {
    message: "Ainda não tenho o catálogo carregado aqui — quer falar com o farmacêutico?",
    bubbleLabel: "Falar com o farmacêutico",
  },
  bookingFailureMessage: "Não consegui concluir isso automaticamente — vou te colocar em contato com o farmacêutico.",
  listingQueryWords: "medicamento produto",
};

export const NICHE_BEHAVIOR: Record<Niche, NicheBehavior> = {
  imobiliaria: REAL_ESTATE,
  concessionaria: VEHICLE,
  farmacia: PHARMACY,
};

export function nicheBehavior(niche: Niche): NicheBehavior {
  const behavior = NICHE_BEHAVIOR[niche];
  if (!behavior) throw new Error(`No chat behavior registered for niche: ${String(niche)}`);
  return behavior;
}

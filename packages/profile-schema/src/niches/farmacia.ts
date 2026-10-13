import type { NicheTemplate } from "../types";

// Pharmacy niche template (persona: Alex, an AI assistant that never recommends medicine).
// Onboarding interview questions come from docs/pharmacy/HANDOFF.md D7. The structured answers the
// code must enforce (delivery area / fee, minimum order, pickup, limits, payment methods) are
// proposed into PharmacySettings.proposals for the owner to confirm on the dashboard — see
// `farmaciaSettingsFieldMap` below and docs/pharmacy/API.md ("Pharmacy settings").
export const farmaciaTemplate: NicheTemplate = {
  niche: "farmacia",
  version: "0.1.0",
  fields: [
    { key: "razao_social_cnpj", label: "Razão social e CNPJ", weight: "required" },
    { key: "afe_licenca", label: "Licença / Autorização de Funcionamento (AFE)", weight: "required" },
    { key: "farmaceutico_responsavel", label: "Farmacêutico responsável (RT) e CRF", weight: "required" },
    { key: "horario_funcionamento", label: "Horário de funcionamento", weight: "required", type: "hours" },
    { key: "areas_entrega", label: "Áreas (bairros / CEPs) atendidas na entrega", weight: "required" },
    { key: "taxa_entrega", label: "Taxa de entrega", weight: "required", type: "price" },
    { key: "pedido_minimo", label: "Pedido mínimo", weight: "recommended", type: "price" },
    { key: "retirada_loja", label: "Retirada em loja", weight: "required" },
    { key: "limite_quantidade_item", label: "Quantidade máxima por item", weight: "recommended" },
    { key: "produtos_exigem_farmaceutico", label: "Produtos de venda livre que sempre exigem o farmacêutico", weight: "recommended" },
    { key: "formas_pagamento_entrega", label: "Formas de pagamento na entrega / retirada", weight: "required" },
    { key: "politica_troca_devolucao", label: "Política de troca e devolução", weight: "optional" },
  ],
  interviewQuestions: [
    { id: "iq1", prompt: "Qual é a razão social e o CNPJ da farmácia?", fillsField: "razao_social_cnpj" },
    { id: "iq2", prompt: "Qual o número da licença de funcionamento (AFE) da farmácia?", fillsField: "afe_licenca" },
    { id: "iq3", prompt: "Quem é o farmacêutico responsável e qual o número do CRF?", fillsField: "farmaceutico_responsavel" },
    { id: "iq4", prompt: "Quais são os horários de funcionamento?", fillsField: "horario_funcionamento" },
    { id: "iq5", prompt: "Quais bairros ou CEPs vocês atendem na entrega?", fillsField: "areas_entrega" },
    { id: "iq6", prompt: "Qual a taxa de entrega?", fillsField: "taxa_entrega" },
    { id: "iq7", prompt: "Existe um valor mínimo de pedido?", fillsField: "pedido_minimo" },
    { id: "iq8", prompt: "Vocês têm retirada em loja?", fillsField: "retirada_loja" },
    { id: "iq9", prompt: "Existe quantidade máxima por item em cada pedido?", fillsField: "limite_quantidade_item" },
    { id: "iq10", prompt: "Algum produto de venda livre que sempre precisa passar pelo farmacêutico?", fillsField: "produtos_exigem_farmaceutico" },
    { id: "iq11", prompt: "Quais formas de pagamento vocês aceitam na entrega ou na retirada?", fillsField: "formas_pagamento_entrega" },
    { id: "iq12", prompt: "Como funciona a política de troca e devolução?", fillsField: "politica_troca_devolucao" },
  ],
  defaultChips: ["Fazer um pedido", "Falar com o farmacêutico", "Horários e entrega"],
  chipGraph: [
    { state: "after_product", chips: ["Adicionar ao carrinho", "Ver outro produto", "Falar com o farmacêutico"] },
    { state: "after_cart", chips: ["Finalizar pedido", "Continuar comprando"] },
    { state: "after_order", chips: ["Acompanhar pedido", "Falar com o farmacêutico"] },
  ],
  fixedFlows: [
    { id: "order", label: "Fazer um pedido", triggerIntents: ["pedido", "comprar", "quero", "tem"] },
    { id: "pharmacist", label: "Falar com o farmacêutico", triggerIntents: ["farmacêutico", "sintoma", "dor", "receita"] },
    { id: "info", label: "Horários e entrega", triggerIntents: ["horário", "entrega", "taxa", "retirada", "aberto"] },
  ],
  evalQuestions: [
    "Qual o horário de funcionamento da farmácia?",
    "Vocês entregam no meu bairro? Qual a taxa?",
    "Posso retirar o pedido na loja?",
    "Qual o valor mínimo de pedido?",
    "Quais formas de pagamento vocês aceitam na entrega?",
    "Quem é o farmacêutico responsável?",
    "Como funciona a troca ou devolução?",
    "Vocês aceitam receita de medicamento?",
  ],
};

/**
 * Which PharmacySettings keys each interview field proposes (consumed by wave-2 pharmacy-settings
 * "proposals"). The owner must confirm every proposal; nothing is applied silently.
 */
export const farmaciaSettingsFieldMap: Record<string, string[]> = {
  razao_social_cnpj: ["legalName", "cnpj"],
  afe_licenca: ["afeNumber"],
  farmaceutico_responsavel: ["pharmacistName", "pharmacistCrf"],
  horario_funcionamento: ["openingHours"],
  areas_entrega: ["deliveryAreas"],
  taxa_entrega: ["deliveryFeeCents"],
  pedido_minimo: ["minOrderCents"],
  retirada_loja: ["pickupEnabled"],
  limite_quantidade_item: ["maxQtyPerItemDefault"],
  produtos_exigem_farmaceutico: ["pharmacistRequiredProductNames"],
  formas_pagamento_entrega: ["paymentMethods"],
  politica_troca_devolucao: ["exchangePolicy"],
};

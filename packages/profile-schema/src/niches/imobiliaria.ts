import type { NicheTemplate } from "../types";

export const imobiliariaTemplate: NicheTemplate = {
  niche: "imobiliaria",
  version: "0.1.0",
  fields: [
    { key: "tipos_imovel", label: "Tipos de imóvel disponíveis", weight: "required" },
    { key: "documentos_exigidos", label: "Documentos exigidos do locatário", weight: "required" },
    { key: "aceita_fiador", label: "Aceita fiador / seguro fiança", weight: "required" },
    { key: "valor_taxa_administracao", label: "Taxa de administração", weight: "required" },
    { key: "politica_pets", label: "Política de animais de estimação", weight: "recommended" },
    { key: "prazo_minimo_contrato", label: "Prazo mínimo de contrato", weight: "recommended" },
    { key: "horario_visitas", label: "Horário disponível para visitas", weight: "required" },
    { key: "prazo_analise_credito", label: "Prazo médio de análise de crédito", weight: "recommended" },
    { key: "reajuste_anual", label: "Política de reajuste anual", weight: "optional" },
    { key: "vistoria_saida", label: "Processo de vistoria de saída", weight: "optional" },
  ],
  interviewQuestions: [
    { id: "iq1", prompt: "Quais tipos de imóveis vocês têm disponíveis para locação hoje?", fillsField: "tipos_imovel" },
    { id: "iq2", prompt: "Quais documentos vocês pedem de quem quer alugar?", fillsField: "documentos_exigidos" },
    { id: "iq3", prompt: "Vocês aceitam fiador, ou só seguro fiança?", fillsField: "aceita_fiador" },
    { id: "iq4", prompt: "Qual a taxa de administração cobrada?", fillsField: "valor_taxa_administracao" },
    { id: "iq5", prompt: "Vocês aceitam imóveis com pets?", fillsField: "politica_pets" },
    { id: "iq6", prompt: "Qual o prazo mínimo de contrato que vocês praticam?", fillsField: "prazo_minimo_contrato" },
    { id: "iq7", prompt: "Em quais horários vocês conseguem fazer visitas?", fillsField: "horario_visitas" },
    { id: "iq8", prompt: "Quanto tempo leva a análise de crédito normalmente?", fillsField: "prazo_analise_credito" },
  ],
  defaultChips: ["Quanto custa?", "Quais documentos preciso?", "Agendar visita", "Onde fica?"],
  chipGraph: [
    { state: "after_price", chips: ["Aceita fiador?", "Tem desconto no plano anual?", "Quero agendar"] },
    { state: "after_documents", chips: ["Posso enviar por WhatsApp?", "Quanto tempo demora a análise?", "Agendar visita"] },
    { state: "after_booking", chips: ["Como chego lá?", "O que devo levar?", "Falar com atendente"] },
  ],
  fixedFlows: [
    { id: "document_checklist", label: "Checklist de documentos", triggerIntents: ["documentos", "o que preciso"] },
    { id: "booking", label: "Agendar visita", triggerIntents: ["agendar", "visita", "marcar horário"] },
  ],
  evalQuestions: [
    "Quais documentos preciso para alugar um apartamento?",
    "Vocês aceitam fiador ou só seguro fiança?",
    "Qual o valor do IPTU desse imóvel?",
    "O apartamento aceita pets?",
    "Posso agendar uma visita para sábado de manhã?",
  ],
};

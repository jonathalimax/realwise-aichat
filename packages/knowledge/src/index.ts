import type { AssistantDecision, KnowledgeSource, NormalizedMessage } from "@realwise/contracts";

const HANDOFF_TERMS = ["humano", "atendente", "pessoa", "reclamação", "cancelar"];
const APPOINTMENT_TERMS = ["aula experimental", "agendar", "horário", "marcar", "visita"];

export function chunkKnowledge(body: string, maxChars = 900): string[] {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += maxChars) {
    chunks.push(normalized.slice(index, index + maxChars));
  }
  return chunks;
}

export function fakeAssistantDecision(
  message: NormalizedMessage,
  sources: Pick<KnowledgeSource, "id" | "title">[],
  options: { humanActive: boolean; aiEnabled: boolean },
): AssistantDecision {
  const text = (message.text ?? "").toLocaleLowerCase("pt-BR");
  if (!options.aiEnabled) {
    return { action: "PAUSE", confidence: 1, response: null, citedSourceIds: [], reason: "AI disabled for tenant" };
  }
  if (options.humanActive || HANDOFF_TERMS.some((term) => text.includes(term))) {
    return {
      action: "HANDOFF",
      confidence: 0.95,
      response: "Vou chamar uma pessoa da equipe para te ajudar por aqui.",
      citedSourceIds: [],
      reason: "Human requested or conversation already human-active",
    };
  }
  const citedSourceIds = sources.slice(0, 2).map((source) => source.id);
  if (APPOINTMENT_TERMS.some((term) => text.includes(term))) {
    return {
      action: "ASK_CLARIFYING_QUESTION",
      confidence: 0.82,
      response: "Posso registrar seu interesse em uma aula experimental. Qual dia e horário você prefere? A equipe confirma a disponibilidade depois.",
      citedSourceIds,
      reason: "Appointment request must not be falsely confirmed",
    };
  }
  return {
    action: "ANSWER",
    confidence: citedSourceIds.length > 0 ? 0.78 : 0.42,
    response: citedSourceIds.length > 0
      ? "Com base nas informações aprovadas pela empresa, posso te ajudar com preços, horários e próximos passos. O que você gostaria de saber?"
      : "Ainda não tenho informação aprovada suficiente sobre isso. Vou encaminhar para a equipe confirmar com segurança.",
    citedSourceIds,
    reason: citedSourceIds.length > 0 ? "Grounded answer available" : "Insufficient tenant knowledge",
  };
}

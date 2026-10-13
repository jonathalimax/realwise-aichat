import type { Niche } from "@realwise/db";

export function listingSuggestions(niche: Niche, transaction?: string | null): string[] {
  const t = transaction?.toLowerCase().trim();

  const suggestions = (() => {
    if (niche === "concessionaria") {
      return ["Posso agendar um test-drive?", "Aceita meu carro na troca?", "Tem financiamento?"];
    }
    // TODO(wave2:chat-engine): the pharmacy has no listings; product cards use their own suggestions.
    if (niche === "farmacia") return [];

    if (t === "aluguel") {
      return ["Posso agendar uma visita?", "Quais documentos preciso?", "Tem taxa de administração?"];
    }

    if (t === "venda") {
      return ["Posso agendar uma visita?", "Aceita financiamento?", "Qual o valor do condomínio?"];
    }

    return ["Posso agendar uma visita?", "Esse imóvel é para alugar ou comprar?", "Qual o valor?"];
  })();

  // Defensive cap matching the chat UI's own bubble/suggestion limit — should already be ≤3 above.
  return suggestions.slice(0, 5);
}

export function listingSuggestions(niche: string, transaction?: string | null): string[] {
  const t = transaction?.toLowerCase().trim();

  if (niche === "concessionaria") {
    return ["Posso agendar um test-drive?", "Aceita meu carro na troca?", "Tem financiamento?"];
  }

  if (t === "aluguel") {
    return ["Posso agendar uma visita?", "Quais documentos preciso?", "Tem taxa de administração?"];
  }

  if (t === "venda") {
    return ["Posso agendar uma visita?", "Aceita financiamento?", "Qual o valor do condomínio?"];
  }

  return ["Posso agendar uma visita?", "Esse imóvel é para alugar ou comprar?", "Qual o valor?"];
}

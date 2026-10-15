// Non-clinical questions Alex cannot answer from settings/knowledge base/profile (opening on holidays,
// promotions, parking, invoices ...): they become a `general_question` handoff for an ATTENDANT, never the
// pharmacist. Pure helpers, no database. Clinical questions stay with the pharmacist lane.

import { fold } from "./text";

/** Topics a pharmacy's settings never cover (holidays, promotions, parking, invoices): the team confirms. Other unknowns reach the model first. */
const UNKNOWN_STORE_TOPICS =
  /\b(feriados?|promocao|promocoes|desconto|descontos|cupom de desconto|cupons|oferta|ofertas|brinde|cashback|programa de (fidelidade|pontos)|estacionamento|manobrista|nota fiscal|nf|nfe|cupom fiscal|recibo)\b/;

export function unknownStoreTopic(f: string): boolean {
  return UNKNOWN_STORE_TOPICS.test(f);
}

const CLINICAL =
  /\b(sintoma|sintomas|dor|dores|febre|tosse|alergia|gravida|gravidez|amamentando|amamentacao|bula|dose|dosagem|posologia|interage|interacao|interacoes|efeito colateral|efeitos colaterais|contraindicad\w*|contraindicacao|posso tomar|pode tomar|devo tomar|pode misturar|misturar|remedio para|remedio pra|medicamento para|medicamento pra|qual remedio|qual medicamento|indica|indicacao|receita medica|crianca|bebe|idoso|diabetes|pressao|antibiotico|tratamento|doenca)\b/;

/** Anything that smells clinical goes to the pharmacist, never to a general (attendant) question. */
export function clinicalQuestion(text: string): boolean {
  return CLINICAL.test(fold(text));
}

const QUESTION_START = /^(qual|quais|quando|onde|como|quanto|quantos|quem|tem|temos|voces|ha|existe|posso|pode|podem|da pra|aceitam|aceita|fazem|faz|trabalham|trabalha|funciona|funcionam|atendem|atende|e possivel|tem como|vcs)\b/;

/** A question (or a request for information), not a greeting or a short acknowledgement. */
export function looksLikeQuestion(text: string): boolean {
  const raw = text.trim();
  const f = fold(raw);
  if (f.length < 4) return false;
  if (/\?/.test(raw)) return f.split(" ").length >= 2;
  if (QUESTION_START.test(f)) return f.split(" ").length >= 3;
  return f.split(" ").length >= 5;
}

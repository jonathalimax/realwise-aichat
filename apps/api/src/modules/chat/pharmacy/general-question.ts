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
  /\b(sintoma|sintomas|dor|dores|febre|tosse|alergia|gravida|gravidez|amamentando|amamentacao|bula|dose|dosagem|posologia|interage|interacao|interacoes|efeito colateral|efeitos colaterais|contraindicad\w*|contraindicacao|posso tomar|pode tomar|devo tomar|pode misturar|misturar|remedio para|remedio pra|medicamento para|medicamento pra|qual remedio|qual medicamento|indica|indicacao|receita medica|crianca|bebe|idoso|diabetes|pressao|antibiotico|tratamento|doenca)\b|\b(posso|pode|devo|da pra) (dar|tomar|misturar)\b/;

/** Anything that smells clinical goes to the pharmacist, never to a general (attendant) question. */
export function clinicalQuestion(text: string): boolean {
  const f = fold(text);
  // "Vocês medem pressão arterial?" asks about a store SERVICE, not about health: only the words pressão/diabetes are
  // forgiven, and only next to a service verb. Any other clinical word still escalates.
  if (SERVICE_VERB.test(f) && /\b(pressao|diabetes)\b/.test(f) && !/\b(alta|baixa|subiu|caiu|controlar|controle|remedio|tomo|tomar|minha|meu|estou|estar|esta|sinto)\b/.test(f)) return CLINICAL.test(f.replace(/\bpressao( arterial)?\b/g, " ").replace(/\bdiabetes\b/g, " "));
  return CLINICAL.test(f);
}

const SERVICE_VERB = /\b(mede|medem|medir|medicao|afere|aferem|aferir|aferic\w+|fazem|oferecem|servico|servicos|cobram|custa|valor|preco|gratis|gratuito)\b/;

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

const OFF_TOPIC =
  /\b(piada|piadas|capital d[aeo]s?|previsao do tempo|horoscopo|signo|futebol|placar|quem ganhou|receita de (bolo|pizza|comida)|poema|poesia|cantar|musica|filme|novela|bitcoin|cotacao|presidente|quanto e \d+ ?[+x*/-] ?\d+|conta uma|me conta (uma|algo))\b/;

/** Chit-chat that has nothing to do with the pharmacy (jokes, trivia, sports): answered kindly, never escalated to the team. */
export function offTopicChat(text: string): boolean {
  const f = fold(text);
  return OFF_TOPIC.test(f) && !CLINICAL.test(f);
}

const GENERIC_PLACES = new Set(["casa", "minha casa", "domicilio", "regiao", "minha regiao", "cidade", "minha cidade", "bairro", "meu bairro", "todo lugar", "qualquer lugar", "curitiba"]);

/** "vocês entregam em Santa Felicidade?" -> "santa felicidade" (null when no specific place is named). */
export function askedDeliveryPlace(text: string): string | null {
  const f = fold(text);
  const m = f.match(/\b(?:entreg\w*|atend\w*|chega\w*|levam?|leva)\b.{0,14}?\b(?:em|no|na|nos|nas|para|pra|ate)\s+(?:o |a |os |as )?([a-z0-9][a-z0-9 ]{2,38})$/);
  if (!m) return null;
  const place = m[1].trim();
  return GENERIC_PLACES.has(place) || place.split(" ").length > 4 ? null : place;
}

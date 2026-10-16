// Pharmacy output guards (pt-BR). Pure functions. They run on every customer-visible text that is
// NOT taken verbatim from a catalog row (model phrasing, free text) and as a last line of defense on
// lane E (symptom) replies:
//   - dosage / posology / how-to-use advice is removed;
//   - recommendations of a medicine ("recomendo tomar X", "você pode tomar X") are removed;
//   - in lane E, any sentence that names a catalog product or active ingredient is removed.
// Sentences are dropped, never "corrected": we do not know the right content, so we say nothing.

import { fold } from "./text";

const UNIT = String.raw`(?:mg|mcg|g|ml|ui|gotas?|comprimidos?|comp|capsulas?|caps|sache|ampolas?|colheres?|doses?|aplicacoes|pastilhas?|supositorios?|jatos?|puffs?)`;

const DOSAGE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:tom(?:e|ar|ando|a)|use|usar|usa|aplique|aplicar|ingira|ingerir|administre|administrar|dar|pingue|inale|misture|dissolva|mastigue|engula)\b[^.!?\n]{0,60}\b\d+(?:[.,]\d+)?\s?${UNIT}\b`),
  /\b(?:de|a cada)\s+\d+\s*(?:em\s*\d+\s*)?(?:horas?|h)\b/,
  /\b\d+\s*(?:vezes|x)\s*(?:ao|por|no|pelo|na)\s*(?:dia|semana|hora)\b/,
  /\b(?:uma|duas|tres|quatro|1|2|3|4)\s+vez(?:es)?\s+(?:ao|por|no|pelo)\s+dia\b/,
  /\bposologia\b|\bdosagem (?:recomendada|ideal|correta|maxima|segura|certa)\b|\bdose (?:maxima|diaria|recomendada|ideal|correta|segura|certa|usual|habitual|pediatrica)\b/,
  new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s?${UNIT}\s*(?:por|/)\s*(?:kg|dia|vez|dose|hora)\b`),
  /\bcomo (?:tomar|usar|aplicar|administrar)\b|\bmodo de (?:uso|usar)\b|\bforma de uso\b/,
  /\b(?:tome|tomar|tomando)\b[^.!?\n]{0,40}\b(?:comprimidos?|capsulas?|gotas?|colheres?|sache)\b/,
  /\b(?:antes|depois|durante|junto)\s+(?:das?|de|com)\s+(?:refeicoes|refeicao|comida|alimentos|cafe da manha|almoco|jantar)\b[^.!?\n]{0,30}\b(?:tome|tomar|use|usar)\b/,
  /\bpode (?:aumentar|dobrar|repetir|diminuir|reduzir) a dose\b|\bdose (?:extra|dobrada)\b/,
];

const RECOMMEND_PATTERNS: RegExp[] = [
  /\b(?:recomendo|sugiro|indico|aconselho|prescrevo|receito|aconselharia|recomendaria|sugeriria)\b/,
  /\b(?:voce|vc|ele|ela|seu filho|sua filha)\s+(?:pode|poderia|deve|deveria|precisa|tem que|vai poder)\s+(?:tomar|usar|comprar|experimentar|dar|aplicar|passar|ingerir|fazer uso)\b/,
  /\b(?:pode|poderia|deve|deveria)\s+(?:tomar|usar|experimentar|ingerir|fazer uso de)\b/,
  /\b(?:o|um)\s+(?:remedio|medicamento|produto|analgesico|antitermico|anti inflamatorio|antibiotico|xarope|pomada|colirio|spray)\s+(?:ideal|indicado|recomendado|certo|adequado|melhor)\b/,
  /\bmelhor\s+(?:remedio|medicamento|opcao|escolha|produto)\b/,
  /\b(?:indicado|recomendado|ideal)\s+(?:para|pra|contra)\s+(?:dor|febre|tosse|gripe|resfriado|alergia|azia|nausea|diarreia|enjoo)\b/,
  /\bexperimente\b|\bque tal (?:tomar|usar|experimentar)\b|\bpara (?:isso|essa dor|esse sintoma|a dor|a febre)[^.!?\n]{0,25}\b(?:tome|tomar|use|usar)\b/,
  /\b(?:costuma|costumam|geralmente|normalmente)\s+(?:ajudar|funcionar|aliviar|indicad[oa]s?)\b[^.!?\n]{0,30}\b(?:tomar|usar|remedio|medicamento)\b/,
];

const SENTENCE_SPLIT = /(?<=[.!?\n])\s+/;

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

export function hasDosageAdvice(text: string): boolean {
  const f = fold(text);
  return DOSAGE_PATTERNS.some((p) => p.test(f));
}

export function hasRecommendation(text: string): boolean {
  const f = fold(text);
  return RECOMMEND_PATTERNS.some((p) => p.test(f));
}

export const DOSAGE_REFUSAL =
  "Quero que você use tudo com segurança, por isso dose, horários e modo de uso quem orienta é o farmacêutico. Posso chamá-lo para você agora.";

export interface GuardResult {
  text: string;
  removed: string[];
  /** true when nothing usable was left and the text was replaced by the fixed refusal. */
  replaced: boolean;
}

/**
 * Removes dosage/posology sentences and medicine recommendations. `forbiddenTerms` (folded
 * internally): any sentence containing one of them is also dropped (lane E: catalog product names
 * and active ingredients must never reach the customer-visible message).
 */
export function guardPharmacyText(text: string, opts: { forbiddenTerms?: string[]; dropRecommendations?: boolean } = {}): GuardResult {
  const dropRecommendations = opts.dropRecommendations ?? true;
  const forbidden = (opts.forbiddenTerms ?? [])
    .map((t) => fold(t))
    .filter((t) => t.length >= 4);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const sentence of splitSentences(text)) {
    const f = fold(sentence);
    const dosage = DOSAGE_PATTERNS.some((p) => p.test(f));
    const recommends = dropRecommendations && RECOMMEND_PATTERNS.some((p) => p.test(f));
    const names = forbidden.some((term) => new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(f));
    if (dosage || recommends || names) removed.push(sentence);
    else kept.push(sentence);
  }
  if (removed.length === 0) return { text, removed, replaced: false };
  const cleaned = kept.join(" ").trim();
  const meaningful = cleaned.replace(/[^\p{L}]/gu, "").length >= 12;
  if (!meaningful) return { text: DOSAGE_REFUSAL, removed, replaced: true };
  return { text: cleaned, removed, replaced: false };
}

/** Lane E / free-text safety net: no dosage, no recommendation, no catalog names. */
export function guardSymptomLaneText(text: string, catalogTerms: string[]): GuardResult {
  return guardPharmacyText(text, { forbiddenTerms: catalogTerms, dropRecommendations: true });
}

/** Does the visitor ask for dosage/usage instructions? (Answered with the fixed refusal, never by the model.) */
export function asksForDosage(text: string): boolean {
  const f = fold(text);
  return (
    /\bquanto\s+(?:eu\s+|posso\s+|devo\s+|pode\s+)*(?:tomar|usar|dar|aplicar)\b/.test(f) ||
    /\b(?:qual|quais)\s+(?:a\s+|e\s+a\s+)?(?:dose|dosagem|posologia)\b/.test(f) ||
    /\b(?:de quanto em quanto tempo|quantas vezes (?:ao|por) dia|quantos comprimidos|quantas gotas|quantos ml)\b/.test(f) ||
    /\bcomo (?:tomar|usar|aplicar|dar)\b/.test(f) ||
    /\bposologia\b/.test(f) ||
    /\bdose (?:para|pra|de|do|da)\b/.test(f)
  );
}

// Red-flag detector (pt-BR). Pure, deterministic, runs BEFORE any other logic on every visitor turn.
// A hit means: stop selling, show the fixed urgent-care reply (SAMU 192), offer the pharmacist and
// create an urgent PharmacistHandoff. Deliberately biased toward false positives: an unnecessary
// "ligue 192" costs a click, a missed emergency costs far more.

import { fold } from "./text";

export type RedFlagKind =
  | "chest_pain"
  | "breathing"
  | "overdose"
  | "seizure"
  | "unconscious"
  | "infant_fever"
  | "stroke"
  | "bleeding"
  | "severe_allergy"
  | "self_harm"
  | "poisoning";

export interface RedFlagHit {
  kind: RedFlagKind;
  /** Short neutral label stored in the handoff brief (never the visitor's raw text). */
  label: string;
}

interface Rule {
  kind: RedFlagKind;
  label: string;
  pattern: RegExp;
  /** Skip the "não tenho …" negation check (the phrase itself already carries a negative: "sem ar"). */
  noNegationCheck?: boolean;
}

const RULES: Rule[] = [
  { kind: "chest_pain", label: "Dor ou aperto no peito", pattern: /\b(dor|dores|aperto|pressao|queimacao forte|facada)\b.{0,12}\b(no|do|em|pro)\b.{0,6}\b(peito|torax|coracao)\b|\bdor toracica\b|\binfarto\b|\bataque (do|de) coracao\b|\bpeito (apertando|doendo|dolorido)\b/ },
  { kind: "breathing", label: "Falta de ar / dificuldade para respirar", pattern: /\bfalta de ar\b|\bnao (consigo|to conseguindo|estou conseguindo) respirar\b|\bdificuldade (para|de|em|pra) respirar\b|\brespirar (mal|com dificuldade)\b|\bengasg\w+|\bsufoc\w+|\bsem folego\b|\bchiado (forte )?no peito\b/ },
  { kind: "breathing", label: "Falta de ar / dificuldade para respirar", pattern: /\b(to|estou|ta|esta|fiquei)\s+sem\s+ar\b/, noNegationCheck: true },
  { kind: "overdose", label: "Possível overdose ou uso excessivo de medicamento", pattern: /\boverdose\b|\bsobredose\b|\b(tomei|tomou|ingeri|ingeriu|engoli|engoliu|tomamos)\b.{0,40}\b(muito|demais|a mais|varios|varias|todos|todas|cartela|frasco inteiro|caixa inteira|cartela inteira|dose dobrada|dose errada)\b|\b(tomei|tomou)\b.{0,25}\b(remedios?|comprimidos?|pilulas?)\b.{0,20}\b(de uma vez|de uma so vez)\b|\bexagerei (no|nos|na) (remedio|remedios|medicamento)\b/ },
  { kind: "poisoning", label: "Possível intoxicação ou envenenamento", pattern: /\bintoxica\w+|\benvenena\w+|\b(tomou|bebeu|engoliu|ingeriu)\b.{0,30}\b(veneno|produto de limpeza|agua sanitaria|soda caustica|chumbinho|raticida|inseticida)\b|\bveneno\b/ },
  { kind: "poisoning", label: "Criança ou pessoa que ingeriu medicamento ou produto sozinho", pattern: /\b(crianca|filh[oa]|bebe|neto|neta|sobrinh[oa])\b.{0,30}\b(engoliu|tomou|ingeriu|comeu|bebeu)\b.{0,30}\b(sozinh[oa]|escondid[oa]|varios|varias|muitos|muitas|cartela|frasco|caixa|todos|todas|a mais)\b/ },
  { kind: "poisoning", label: "Picada ou mordida de animal peçonhento", pattern: /\b(picad\w+|mordid\w+|picou|mordeu)\b.{0,20}\b(cobra|escorpiao|serpente|aranha armadeira|aranha marrom)\b/ },
  { kind: "stroke", label: "Dor de cabeça súbita e muito intensa ou rigidez no pescoço", pattern: /\bpior dor (de cabeca )?da (minha )?vida\b|\bdor de cabeca\b.{0,25}\b(subita|repentina|explosiva|de repente)\b|\b(pescoco)\b.{0,20}\b(duro|rigido|travado)\b|\brigidez (no|de) pescoco\b/ },
  { kind: "bleeding", label: "Queimadura grave", pattern: /\bqueimadura\b.{0,20}\b(grave|extensa|no rosto|muito grande|profunda)\b|\bqueimou\b.{0,25}\b(rosto|corpo todo|muito)\b/ },
  { kind: "infant_fever", label: "Febre muito alta", pattern: /\bfebre\b.{0,12}\b(de |acima de |maior que |chegou a |passou de )?(40|41|42)\b|\b(40|41|42)\b\s*(graus|c)\b.{0,15}\bfebre\b/ },
  { kind: "seizure", label: "Convulsão", pattern: /\bconvuls\w+|\bataque epileptico\b|\bcrise epileptica\b|\bconvulsionando\b|\bepilepsia\b.{0,20}\b(crise|agora)\b/ },
  { kind: "unconscious", label: "Desmaio ou perda de consciência", pattern: /\bdesmai\w+|\bperdeu (a )?consciencia\b|\bperdi (a )?consciencia\b|\binconsciente\b|\bnao (acorda|responde|reage)\b|\bdesacordad\w+|\bapagou\b|\bpassando mal\b.{0,20}\b(muito|forte|demais)\b/ },
  {
    kind: "infant_fever",
    label: "Febre em bebê",
    pattern: /\b(bebe|bebes|recem nascid\w*|neném|nenem|lactente)\b.{0,50}\b(febre|febril|quente|38|39|40)\b|\b(febre|febril)\b.{0,50}\b(bebe|bebes|recem nascid\w*|nenem|lactente)\b|\b(filh[oa]|bebe|nenem)\b.{0,25}\b(\d{1,2})\s*(dias?|semanas?|meses|mes)\b.{0,40}\b(febre|febril)\b|\b(febre|febril)\b.{0,40}\b(filh[oa]|bebe|nenem)\b.{0,25}\b\d{1,2}\s*(dias?|semanas?|meses|mes)\b/,
  },
  { kind: "stroke", label: "Sinais de AVC", pattern: /\b(rosto|boca)\b.{0,12}\b(torto|torta|caido|caida|repuxad\w+)\b|\bfala (enrolada|arrastada|embolada)\b|\bparalisia\b|\bfraqueza (subita|de repente)\b|\bperdi a visao (de repente|subitamente)\b|\bderrame\b|\bavc\b|\bacidente vascular\b|\bnao consigo (mexer|mover) (o|a|um|uma)\b/ },
  { kind: "bleeding", label: "Sangramento importante", pattern: /\bhemorragia\b|\bsangramento (forte|intenso|grande|que nao para|sem parar)\b|\bsangue (nao para|sem parar)\b|\b(vomit\w+|tossindo|cuspindo|expelindo|urinando)\b.{0,12}\bsangue\b|\bfezes (com|de) sangue\b.{0,15}\b(muito|bastante)\b|\bgravida\b.{0,30}\bsangr\w+|\bsangr\w+\b.{0,30}\bgravida\b/ },
  { kind: "severe_allergy", label: "Reação alérgica grave", pattern: /\banafila\w+|\bgarganta (fechando|inchando|fechou|inchou)\b|\blingua inchada\b|\b(rosto|labios|lingua|olhos)\b.{0,15}\binchad\w+\b.{0,40}\b(respirar|ar|engolir)\b|\bchoque alergico\b|\breacao alergica (grave|forte|severa)\b|\bnao consigo engolir\b/ },
  { kind: "self_harm", label: "Pensamentos de se machucar", pattern: /\bquero (me )?matar\b|\bme matar\b|\bacabar com (a )?(minha )?vida\b|\btirar (a )?(minha )?(propria )?vida\b|\bsuicid\w+|\bautomutila\w+|\bnao quero mais viver\b|\bquero morrer\b|\bpensando em morrer\b|\bme machucar\b/ },
];

// "não tenho falta de ar", "sem dor no peito", "nunca tive convulsão": a negation shortly before the match.
// "não tenho falta de ar", "sem dor no peito", "nunca tive convulsão": a negation hugging the match.
const NEGATION_BEFORE =
  /\b(?:sem|nada de|nenhum|nenhuma|nao (?:tenho|tem|tive|teve|sinto|senti|sentiu|estou com|to com|esta com|apresenta|apresentou|houve|ha|ocorreu)|nunca (?:tive|teve|tem|senti|sentiu))\s*(?:(?:nenhum|nenhuma|mais|tipo de)\s+)?$/;

export function detectRedFlag(text: string): RedFlagHit | null {
  const f = fold(text);
  if (!f) return null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(f);
    if (!match) continue;
    if (!rule.noNegationCheck) {
      const before = f.slice(Math.max(0, match.index - 32), match.index);
      if (NEGATION_BEFORE.test(before)) continue;
    }
    return { kind: rule.kind, label: rule.label };
  }
  return null;
}

/** Age (years) given for the patient + a fever mention: a baby under ~3 months with fever is an emergency. */
export function isInfantWithFever(ageText: string | undefined, symptomText: string | undefined): boolean {
  if (!ageText || !symptomText) return false;
  const age = fold(ageText);
  const symptom = fold(symptomText);
  if (!/\b(febre|febril|quente)\b/.test(symptom)) return false;
  if (/\b(bebe|recem nascid\w*|nenem|lactente)\b/.test(age)) return true;
  const months = age.match(/\b(\d{1,2})\s*(meses|mes)\b/);
  if (months && Number(months[1]) <= 3) return true;
  if (/\b(dias?|semanas?)\b/.test(age)) return true;
  return false;
}

export const SAMU_NUMBER = "192";
export const CVV_NUMBER = "188";

export function redFlagReplyText(hit: RedFlagHit): string {
  const base = "Isso pode ser urgente. Ligue 192 (SAMU) ou vá ao pronto-socorro mais próximo agora, sem esperar.";
  if (hit.kind === "self_harm") {
    return `${base} Se você está pensando em se machucar, também pode ligar para o CVV no 188, a qualquer hora, gratuitamente. Você não está sozinho(a). Posso avisar o farmacêutico também.`;
  }
  if (hit.kind === "poisoning" || hit.kind === "overdose") {
    return `${base} Se puder, leve a embalagem do que foi ingerido. Posso avisar o farmacêutico também.`;
  }
  return `${base} Posso avisar o farmacêutico também.`;
}

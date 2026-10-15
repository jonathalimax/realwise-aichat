// Lane E: the symptom-first questionnaire and the pharmacist brief. Pure functions.
// RULES: the customer-visible text of this lane never contains a product name, a dose or a
// recommendation. The brief (with stock-based suggestions) goes ONLY into PharmacistHandoff.brief.

import { fold } from "./text";
import type { ProductRow, SymptomAnswers, SymptomStep } from "./types";

export const SYMPTOM_STEPS: SymptomStep[] = ["symptom", "duration", "severity", "for_whom", "age", "pregnancy", "allergies", "other_medicines", "already_tried"];

export interface StepPrompt {
  step: SymptomStep;
  prompt: string;
  chips: string[];
  allowFreeText: boolean;
}

export const CHIP = {
  consentYes: "Concordo e quero continuar",
  talkToPharmacistNow: "Falar com o farmacêutico agora",
  cancel: "Cancelar",
  chatOnly: "Prefiro continuar só pelo chat",
  skipName: "Pular",
  severity: ["Leve", "Moderada", "Forte"],
  duration: ["Hoje", "1–3 dias", "Mais de 3 dias"],
  forWhom: ["Para mim", "Para outra pessoa adulta", "Para uma criança", "Para um bebê"],
  // The age question depends on who the patient is (adult / child / baby); see ageChips().
  ageAdult: ["18 a 29 anos", "30 a 59 anos", "60 anos ou mais"],
  ageChild: ["Menos de 2 anos", "2 a 5 anos", "6 a 11 anos", "12 a 17 anos"],
  ageBaby: ["Menos de 3 meses", "3 a 11 meses", "1 ano ou mais"],
  pregnancy: ["Não", "Estou grávida", "Estou amamentando", "Prefiro não informar"],
  allergies: ["Não tenho", "Tenho alergia"],
  otherMedicines: ["Não uso outros", "Uso outros remédios"],
  alreadyTried: ["Nada ainda", "Já tentei algo"],
} as const;

export function stepPrompt(step: SymptomStep, answers: SymptomAnswers): StepPrompt {
  switch (step) {
    case "symptom":
      return { step, prompt: "Pode me contar o que você está sentindo?", chips: [], allowFreeText: true };
    case "duration":
      return { step, prompt: "Há quanto tempo você sente isso?", chips: [...CHIP.duration], allowFreeText: true };
    case "severity":
      return { step, prompt: "Como você descreveria a intensidade?", chips: [...CHIP.severity], allowFreeText: true };
    case "for_whom":
      return { step, prompt: "É para você ou para outra pessoa?", chips: [...CHIP.forWhom], allowFreeText: true };
    case "age": {
      const patient = patientOf(answers);
      return {
        step,
        prompt: patient === "baby" ? "Qual a idade do bebê?" : patient === "child" ? "Qual a idade da criança?" : "Qual a idade?",
        chips: [...ageChips(patient)],
        allowFreeText: true,
      };
    }
    case "pregnancy":
      return { step, prompt: "Existe possibilidade de gravidez ou está amamentando?", chips: [...CHIP.pregnancy], allowFreeText: true };
    case "allergies":
      return { step, prompt: "Alguma alergia a medicamentos ou componentes?", chips: [...CHIP.allergies], allowFreeText: true };
    case "other_medicines":
      return { step, prompt: "Está usando algum outro medicamento?", chips: [...CHIP.otherMedicines], allowFreeText: true };
    case "already_tried":
      return { step, prompt: "Já tentou alguma coisa para melhorar?", chips: [...CHIP.alreadyTried], allowFreeText: true };
  }
}

export type Patient = "adult" | "child" | "baby";

export function ageChips(patient: Patient): readonly string[] {
  return patient === "baby" ? CHIP.ageBaby : patient === "child" ? CHIP.ageChild : CHIP.ageAdult;
}

/** Who the questionnaire is about, from the "for whom" answer. */
export function patientOf(a: SymptomAnswers): Patient {
  if (isBaby(a)) return "baby";
  if (isChild(a)) return "child";
  return "adult";
}

/** Age in months as [min, max) from a chip or typed text; null when it carries no number. A bare number is months for a baby, years otherwise. */
export function ageRangeMonths(text: string | undefined, patient: Patient): { min: number; max: number } | null {
  const f = fold(text ?? "");
  if (!f) return null;
  const unit = (n: number, u: string | undefined): number => {
    if (u && /^mes/.test(u)) return n;
    if (u && /^(dia|semana)/.test(u)) return 0;
    if (u && /^ano/.test(u)) return n * 12;
    return patient === "baby" ? n : n * 12;
  };
  const range = f.match(/(\d{1,3})\s*(?:a|ate|-)\s*(\d{1,3})\s*(anos?|meses|mes|dias?|semanas?)?/);
  if (range) {
    const u = range[3];
    return { min: unit(Number(range[1]), u), max: unit(Number(range[2]), u) + (u && /^(mes|dia|semana)/.test(u) ? 1 : 12) };
  }
  const less = f.match(/menos de (\d{1,3})\s*(anos?|meses|mes)?/);
  if (less) return { min: 0, max: unit(Number(less[1]), less[2]) };
  const more = f.match(/(\d{1,3})\s*(anos?|meses|mes)?\s*(?:ou mais|\+)/);
  if (more) return { min: unit(Number(more[1]), more[2]), max: Number.POSITIVE_INFINITY };
  const single = f.match(/(\d{1,3})\s*(anos?|meses|mes|dias?|semanas?)?/);
  if (single) {
    const u = single[2];
    const min = unit(Number(single[1]), u);
    return { min, max: min + (u && /^(mes|dia|semana)/.test(u) ? 1 : 12) };
  }
  return null;
}

/** A typed age that cannot belong to the chosen patient is asked again ("35" for a child). Free text without a number passes. */
export function validateAge(a: SymptomAnswers, value: string): { ok: true } | { ok: false; message: string } {
  const patient = patientOf(a);
  const range = ageRangeMonths(value, patient);
  if (!range) return { ok: true };
  if (patient === "baby" && range.min >= 24) {
    return { ok: false, message: "Essa idade não combina com um bebê. Informe a idade do bebê em dias, meses ou até 1 ano, por favor." };
  }
  if (patient === "child" && range.min >= 18 * 12) {
    return { ok: false, message: "Essa idade não combina com uma criança (até 17 anos). Qual a idade da criança?" };
  }
  if (patient === "adult" && range.min < 12 * 12) {
    return { ok: false, message: "Essa idade não combina com uma pessoa adulta. Se for para uma criança ou um bebê, volte e escolha essa opção; senão, qual a idade?" };
  }
  return { ok: true };
}

/** A baby or a child under 12 stays flagged for the pharmacist's attention in the brief. */
export function isPediatric(a: SymptomAnswers): boolean {
  const patient = patientOf(a);
  if (patient === "baby") return true;
  if (patient === "adult") return false;
  const range = ageRangeMonths(a.age, patient);
  return !range || range.min < 12 * 12;
}

function isBaby(a: SymptomAnswers): boolean {
  return /\bbebe\b/.test(fold(a.forWhom ?? ""));
}

function isChild(a: SymptomAnswers): boolean {
  return /\b(crianca|filho|filha|menino|menina|bebe)\b/.test(fold(a.forWhom ?? ""));
}

/** Pregnancy/breastfeeding only matters for adults/teens (not babies, children, 60+). */
export function pregnancyRelevant(a: SymptomAnswers): boolean {
  if (isBaby(a) || isChild(a)) return false;
  const age = fold(a.age ?? "");
  if (/\b(menos de \d+|60 anos ou mais|1 ano ou mais)\b/.test(age)) return false;
  const years = age.match(/\b(\d{1,3})\b/);
  if (years && !/\b(mes|meses|dia|dias|semana|semanas)\b/.test(age)) {
    const n = Number(years[1]);
    if (n < 12 || n >= 60) return false;
  }
  return true;
}

export function nextStep(current: SymptomStep | null, answers: SymptomAnswers): SymptomStep | "done" {
  const idx = current ? SYMPTOM_STEPS.indexOf(current) : -1;
  for (let i = idx + 1; i < SYMPTOM_STEPS.length; i++) {
    const step = SYMPTOM_STEPS[i];
    if (step === "pregnancy" && !pregnancyRelevant(answers)) continue;
    return step;
  }
  return "done";
}

export function recordAnswer(answers: SymptomAnswers, step: SymptomStep, value: string): SymptomAnswers {
  const v = value.trim().slice(0, 300);
  const next = { ...answers };
  switch (step) {
    case "symptom": next.symptom = v; break;
    case "duration": next.duration = v; break;
    case "severity": next.severity = v; break;
    case "for_whom": next.forWhom = v; break;
    case "age": next.age = v; break;
    case "pregnancy": next.pregnancy = v; break;
    case "allergies": next.allergies = v; break;
    case "other_medicines": next.otherMedicines = v; break;
    case "already_tried": next.alreadyTried = v; break;
  }
  return next;
}

/** A chip that only says "yes, I have one" without the content: ask which, same step. */
export function needsDetail(step: SymptomStep, value: string): boolean {
  const f = fold(value);
  if (step === "allergies") return /^(tenho( alergia)?|sim|tenho sim)$/.test(f);
  if (step === "other_medicines") return /^(uso outros remedios|uso outros|sim|uso sim|uso)$/.test(f);
  if (step === "already_tried") return /^(ja tentei algo|ja tentei|sim|tentei)$/.test(f);
  return false;
}

export function detailPrompt(step: SymptomStep): string {
  if (step === "allergies") return "Qual alergia? Pode escrever o nome do remédio ou do componente.";
  if (step === "other_medicines") return "Quais outros medicamentos você está usando?";
  return "O que você já tentou?";
}

const NONE = /^(nao|nenhum|nenhuma|nada|nao tenho|nao uso|nao uso outros|nao uso nenhum|nada ainda|nunca|sem alergia|nao tenho alergia|nao ha|nao sei|n)$/;

export function toList(value: string | undefined): string[] {
  if (!value) return [];
  const f = fold(value);
  if (NONE.test(f)) return [];
  return value
    .split(/[,;\n]| e (?=[a-zA-ZÀ-ú])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !NONE.test(fold(s)));
}

// ---------------------------------------------------------------------------------------------
// Symptom / recommendation intent
// ---------------------------------------------------------------------------------------------

const SYMPTOM_WORDS =
  "dor|dores|doendo|dolorido|febre|febril|tosse|tossindo|gripe|gripado|resfriado|resfriada|resfriado|coriza|nariz entupido|nariz escorrendo|congestao|espirrando|espirro|nausea|enjoo|enjoado|enjoada|vomito|vomitando|diarreia|azia|queimacao|refluxo|gases|prisao de ventre|constipacao|colica|alergia|coceira|coçando|garganta|rouquidao|cabeca|enxaqueca|tontura|mal estar|fraqueza|insonia|ansiedade|sinusite|infeccao|candidíase|candidiase|inchaco|inchada|inchado|ferida|machucado|queimadura|picada|dor de dente|dor de ouvido|olho vermelho|conjuntivite|cansaco";

const SYMPTOM_STATEMENT = new RegExp(
  String.raw`\b(estou com|to com|tou com|tenho|ta com|esta com|estao com|sinto|sentindo|senti|meu filho|minha filha|minha mae|meu pai|meu marido|minha esposa|meu bebe|minha crianca|estou sentindo|ando com|fiquei com|acordei com|apareceu)\b.{0,50}\b(${SYMPTOM_WORDS})\b`,
);
const SYMPTOM_ONLY = new RegExp(String.raw`^(?:\W*)(?:uma?\s+|muita\s+|muito\s+)?(?:${SYMPTOM_WORDS})\b.{0,40}$`);
const ASKS_RECOMMENDATION =
  /\b(qual|que|quais)\s+(remedio|medicamento|produto|xarope|pomada|comprimido|analgesico|antitermico|antibiotico)s?\b.{0,40}\b(tomar|usar|comprar|para|pra|ideal|melhor|indica|recomenda)\b|\b(me\s+)?(indica|indique|recomenda|recomende|sugere|sugira|aconselha)\b|\bo que\s+(posso|devo|pode|eu|da pra|dá pra)\s+(tomar|usar|passar)\b|\bo que (e|é) bom (para|pra)\b|\btem (algum|alguma|algo)\b.{0,25}\b(para|pra|contra)\b|\bqual (e )?o melhor\b|\bmelhor (remedio|medicamento)\b|\bpreciso de (um )?(remedio|medicamento)\b.{0,20}\b(para|pra)\b/;

export function asksRecommendation(text: string): boolean {
  return ASKS_RECOMMENDATION.test(fold(text));
}

export function detectsSymptomIntent(text: string): boolean {
  const f = fold(text);
  if (!f) return false;
  return SYMPTOM_STATEMENT.test(f) || SYMPTOM_ONLY.test(f) || asksRecommendation(text);
}

// ---------------------------------------------------------------------------------------------
// Brief (pharmacist-only)
// ---------------------------------------------------------------------------------------------

export interface BriefSuggestion {
  productId: string;
  name: string;
  reason: string;
  inStock: boolean;
  priceCents: number;
}

/** Deterministic symptom -> candidate ingredient/name keywords for the PHARMACIST's suggestion list. */
const SUGGESTION_KEYWORDS: Array<{ when: RegExp; keywords: string[] }> = [
  { when: /\b(cabeca|enxaqueca|dor de cabeca|febre|febril|dor de dente|dor de ouvido|dor muscular|dor nas costas|dor)\b/, keywords: ["paracetamol", "dipirona", "ibuprofeno"] },
  { when: /\b(tosse|tossindo)\b/, keywords: ["acetilcisteina", "ambroxol", "xarope"] },
  { when: /\b(garganta|rouquidao)\b/, keywords: ["pastilha", "benzidamina"] },
  { when: /\b(alergia|coceira|espirro|espirrando|rinite)\b/, keywords: ["loratadina", "desloratadina", "cetirizina"] },
  { when: /\b(azia|queimacao|refluxo|ma digestao|gases|estomago)\b/, keywords: ["omeprazol", "hidroxido de aluminio", "sal de fruta"] },
  { when: /\b(diarreia)\b/, keywords: ["reidratacao", "sais"] },
  { when: /\b(enjoo|nausea|enjoado|enjoada|vomito)\b/, keywords: ["dimenidrinato", "metoclopramida"] },
  { when: /\b(congestao|nariz entupido|resfriado|resfriada|gripe|gripado|coriza)\b/, keywords: ["soro fisiologico", "paracetamol", "loratadina"] },
  { when: /\b(colica)\b/, keywords: ["escopolamina", "buscopan"] },
];

export function suggestionKeywords(symptomText: string): string[] {
  const f = fold(symptomText);
  const out = new Set<string>();
  for (const rule of SUGGESTION_KEYWORDS) if (rule.when.test(f)) rule.keywords.forEach((k) => out.add(k));
  return [...out];
}

export function filterSuggestions(candidates: ProductRow[], answers: SymptomAnswers): BriefSuggestion[] {
  const allergies = toList(answers.allergies).map((a) => fold(a));
  const pregnant = /\b(gravida|gravidez|amament\w+)\b/.test(fold(answers.pregnancy ?? ""));
  const range = ageRangeMonths(answers.age, patientOf(answers));
  const infant = isBaby(answers) || Boolean(range && range.min < 24 && patientOf(answers) !== "adult");
  if (infant) return []; // no stock-based suggestion for infants: the pharmacist decides from scratch
  const out: BriefSuggestion[] = [];
  for (const p of candidates) {
    const hay = fold(`${p.name} ${p.activeIngredient ?? ""}`);
    if (allergies.some((a) => a.length >= 4 && (hay.includes(a) || a.split(" ").some((w) => w.length >= 5 && hay.includes(w))))) continue;
    if (pregnant && /ibuprofeno|aas|acido acetilsalicilico/.test(hay)) continue;
    out.push({
      productId: p.id,
      name: p.presentation ? `${p.name} ${p.presentation}` : p.name,
      reason: "Compatível com o sintoma informado. Conferir alergias, idade e interações antes de indicar.",
      inStock: (p.stockQty ?? 0) > 0,
      priceCents: p.priceCents,
    });
    if (out.length >= 3) break;
  }
  return out;
}

export function summaryLine(answers: SymptomAnswers): string {
  const symptom = (answers.symptom ?? "Atendimento solicitado").replace(/\s+/g, " ").trim().slice(0, 80);
  const duration = answers.duration ? ` · ${answers.duration.slice(0, 40)}` : "";
  const text = `${symptom}${duration}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildSymptomBrief(
  answers: SymptomAnswers,
  suggestions: BriefSuggestion[],
  extras: { redFlags?: string[]; conversationId: string; contact?: { firstName: string | null; phoneMasked: string | null } | null },
): Record<string, unknown> {
  const pregnantText = fold(answers.pregnancy ?? "");
  return {
    symptoms: answers.symptom ?? "",
    duration: answers.duration ?? "",
    severity: answers.severity ?? "",
    forWhom: {
      relation: answers.forWhom ?? "",
      age: answers.age ?? "",
      patient: patientOf(answers),
      // A baby or a child under 12: the pharmacist is told to look at it with extra care (pharmacist-only text).
      pediatric: isPediatric(answers),
      ...(isPediatric(answers) ? { attention: "Paciente pediátrico (bebê ou criança menor de 12 anos): conferir idade e cuidados antes de qualquer orientação." } : {}),
      ...(answers.pregnancy
        ? { pregnant: /\b(gravida|gravidez)\b/.test(pregnantText) ? true : /^(nao|nao se aplica)\b/.test(pregnantText) ? false : undefined, pregnancyAnswer: answers.pregnancy }
        : {}),
    },
    allergies: toList(answers.allergies),
    otherMedicines: toList(answers.otherMedicines),
    alreadyTried: toList(answers.alreadyTried),
    redFlags: extras.redFlags ?? [],
    suggestedProducts: suggestions,
    suggestionNote: "Sugestão para o farmacêutico, não enviada ao cliente.",
    ...(extras.contact ? { contact: extras.contact } : {}),
    conversationLink: `/conversas?open=${extras.conversationId}`,
  };
}

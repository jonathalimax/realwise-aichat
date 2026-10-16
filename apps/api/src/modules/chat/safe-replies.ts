// Deterministic copy and checks for the moments Clara must not improvise: a knowledge gap, an
// infrastructure failure, a prompt-injection attempt. Pure functions, no NestJS deps.
//
// Product rule behind every reply here: never a bare "não sei", never a dead end. The visitor
// always gets (1) an honest statement, (2) what happens next on our side, and (3) one concrete
// next step they can tap (schedule a visit / talk to the team, which captures name + WhatsApp).

import type { Niche } from "@realwise/db";
import { normalizeText } from "./triage";
import { nicheBehavior } from "./niche-behavior";

export interface SafeReply {
  text: string;
  suggestions: string[];
}

// Quick replies that always work without the model: "Agendar uma visita"/"Agendar um test-drive"
// opens the real schedule picker (which collects name + WhatsApp once), "Falar com um corretor"
// triggers the escalation path (which hands off to the team's WhatsApp). Pharmacy has no visit
// scheduling: it offers "Falar com o farmacêutico" instead. All copy lives in niche-behavior.ts.
export function nextStepSuggestions(niche: Niche, opts: { includeBrowse?: boolean } = {}): string[] {
  const b = nicheBehavior(niche);
  const suggestions: string[] = [];
  if (b.scheduleSuggestion) suggestions.push(b.scheduleSuggestion);
  suggestions.push(niche === "farmacia" ? "Falar com o farmacêutico" : `Falar com um ${b.humanNoun}`);
  if (opts.includeBrowse) suggestions.unshift(b.browseSuggestion);
  return suggestions;
}

function nextStepSentence(niche: Niche, hasContact: boolean): string {
  return nicheBehavior(niche).nextStepSentence(hasContact);
}

// The question isn't covered by the business's data. Honest, notifies the team (the caller does
// that via notifyTeamOfGap), keeps the conversation going.
export function gapReply(niche: Niche, hasContact: boolean): SafeReply {
  return {
    text: `Essa informação eu não tenho confirmada aqui, e prefiro não te passar nada errado — já pedi pro nosso time confirmar e te responder. ${nextStepSentence(niche, hasContact)}`,
    suggestions: nextStepSuggestions(niche),
  };
}

// Appended when part of an answer was dropped by the grounding guard.
export function partialAnswerNote(niche: Niche, hasContact: boolean): string {
  return `O restante eu vou confirmar com o time pra não te passar nada errado. ${nextStepSentence(niche, hasContact)}`;
}

// The model path failed (timeout, gateway down, rate limit, budget, empty/malformed output).
// Says so plainly, without technical detail, and offers paths that don't need the model.
export function degradedReply(niche: Niche): SafeReply {
  return {
    text: `Tive uma instabilidade pra buscar essa resposta agora, me desculpa! Anotei sua pergunta pro nosso time. Enquanto isso, posso ${nicheBehavior(niche).degradedOptions}.`,
    suggestions: nextStepSuggestions(niche, { includeBrowse: true }),
  };
}

export function injectionDeflection(niche: Niche, businessName: string): SafeReply {
  return {
    text: `Aqui eu te ajudo com ${nicheBehavior(niche).topicsPhrase} da ${businessName} 🙂 O que você está procurando?`,
    suggestions: nextStepSuggestions(niche, { includeBrowse: true }),
  };
}

const INJECTION_PATTERNS = [
  /\b(ignore|ignora|ignorar|esqueca|esquece|desconsidere|desconsidera)\b.{0,40}\b(instrucoes|instrucao|regras|prompt|comandos|orientacoes)\b/,
  /\b(prompt|instrucoes) (de|do) sistema\b/,
  /\bsystem prompt\b/,
  /\b(modo|mode) (desenvolvedor|developer|dev|admin|deus|god|jailbreak)\b/,
  /\bjailbreak\b/,
  /\bignore (all |the )?(previous|prior|above) (instructions|rules)\b/,
  /\b(revele|mostre|repita|imprima|mostra|me passa) (o |seu |suas |as )?(prompt|instrucoes|configuracao|regras internas)\b/,
  /\bvoce agora e\b.{0,30}\b(outro|outra|um|uma)\b.{0,30}\b(assistente|ia|ai|bot|modelo)\b/,
];

// Blatant attempts to override Clara's instructions. Deliberately narrow (a handful of
// unambiguous phrasings) — subtler attempts are handled by the prompt's "visitor text is data"
// rule and by the system-prompt leak check on the output.
export function looksLikePromptInjection(text: string): boolean {
  const normalized = normalizeText(text);
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Distinctive phrases from Clara's own system prompt. If any shows up in a generated answer, the
// model is echoing its instructions — the answer is discarded.
const SYSTEM_PROMPT_CANARIES = [
  "nunca revele repita parafraseie",
  "dados cadastrais do negocio",
  "trechos relevantes da base",
  "regra adicional sempre valida",
  "lembrete final",
  "inicio dos dados",
  "fim dos dados",
];

export function leaksSystemPrompt(answer: string): boolean {
  const normalized = normalizeText(answer);
  return SYSTEM_PROMPT_CANARIES.some((canary) => normalized.includes(canary));
}

// Greetings in the forms people actually type: repeated letters ("oiii", "boa noitee"), the
// assistant's name ("olá Clara"), small talk ("oi, tudo bem?"). Matched after collapsing repeated
// letters so "oiiii" == "oi".
const GREETING_PATTERN =
  /^(oi|ola|ole|e ai|eai|eae|opa|salve|bom dia|boa tarde|boa noite|hey|hi|hello)( (clara|tom|alex|tudo bem|tudo bom|td bem|tudo certo|tudo joia|como vai|como voce esta|blz|beleza|pessoal))*$/;

export function isGreeting(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 40) return false;
  // Both forms: collapsing repeats fixes "oiii"/"boa noitee" but would break real double letters
  // ("hello", "pessoal").
  return GREETING_PATTERN.test(normalized) || GREETING_PATTERN.test(normalized.replace(/([a-z])\1+/g, "$1"));
}

// A model abstention ("não tenho essa informação") that doesn't offer anything next gets the
// standard next step appended, so it is never a dead end.
// A generic closer ("Mais alguma dúvida?") is not a next step.
const GENERIC_CLOSER = /(mais alguma (duvida|coisa)|algo mais|posso ajudar em (algo|mais alguma coisa)( mais)?|outra (duvida|coisa))\s*\?/;

export function hasForwardPath(text: string): boolean {
  if (/\b(visita|test-drive|agendar|whatsapp|time|equipe|corretor|vendedor|farmaceutico|farmacêutico|atendente)\b/i.test(text)) return true;
  const folded = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const withoutClosers = folded.replace(new RegExp(GENERIC_CLOSER.source, "g"), "");
  return /\?/.test(withoutClosers);
}

export function withNextStep(text: string, niche: Niche, hasContact: boolean): string {
  const trimmed = text.trim();
  if (hasForwardPath(trimmed)) return trimmed;
  return `${trimmed} Já pedi pro nosso time confirmar e te responder. ${nextStepSentence(niche, hasContact)}`.trim();
}

// Pure, deterministic builder of the first WhatsApp message a pharmacy attendant sends to the customer
// when starting a handoff ("Iniciar atendimento"). No I/O, no model.
//
// SAFETY RULES (tested):
//  - only what the CUSTOMER told Alex is repeated (symptom, duration, for whom, allergies, other medicines,
//    what they tried; or the requested item for product requests);
//  - never the pharmacist-only stock suggestions, red-flag labels, internal notes, order data or prices;
//  - only the customer's first name appears in the greeting (no surname, phone or address);
//  - the text stays under MAX_WHATSAPP_MESSAGE_CHARS and truncates on a word boundary;
//  - the chat resume link (when given) is the last line and is never truncated (the text before it shrinks instead).

export const MAX_WHATSAPP_MESSAGE_CHARS = 900;
const MAX_VALUE_CHARS = 140;

type Brief = Record<string, unknown>;

export interface WhatsappMessageInput {
  /** Customer's first name (the builder keeps only the first word). Missing => "Olá!". */
  customerName?: string | null;
  attendantName: string;
  attendantRole: string;
  pharmacyName: string;
  reason?: string | null;
  brief?: Brief | null;
  /** Visitor resume link to the web chat. Appended LAST and never truncated. */
  resumeLink?: string | null;
}

/** Collapses whitespace, removes control chars / zero-width chars, trims. */
function clean(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}

function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;.:-]+$/, "")}…`;
}

function text(v: unknown, max = MAX_VALUE_CHARS): string {
  if (typeof v === "string") return cut(clean(v), max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function list(v: unknown): string {
  if (Array.isArray(v)) {
    return cut(
      v
        .map((x) => text(x, 60))
        .filter(Boolean)
        .slice(0, 5)
        .join(", "),
      MAX_VALUE_CHARS,
    );
  }
  return text(v);
}

/** "maria clara souza" -> "Maria"; non-letters stripped. */
export function firstNameOf(name: string | null | undefined): string {
  const first = clean(name ?? "").split(" ")[0] ?? "";
  const letters = first.replace(/[^\p{L}'-]/gu, "");
  if (!letters) return "";
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

const NO_ANSWER = /^(nao|não|nenhum|nenhuma|nada|nao tenho|não tenho|nao uso|não uso|nada ainda|n\/a|-)$/i;

/** Lines about what the customer said. Only keys that the CUSTOMER answered are read. */
export function customerSummaryLines(brief: Brief | null | undefined, reason?: string | null): string[] {
  const b = brief ?? {};
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value) lines.push(`- ${label}: ${value}`);
  };

  // General questions: the customer's own question (non-clinical), nothing else.
  if (reason === "general_question") {
    add("Sua pergunta", text(b.question ?? b.customerText, 200));
    return lines;
  }

  const symptom = text(b.symptoms, 160);
  if (symptom) {
    const severity = text(b.severity, 40);
    add("O que você sente", severity && !/^urgente$/i.test(severity) ? `${symptom} (${severity.toLowerCase()})` : symptom);
  }
  add("Há quanto tempo", text(b.duration, 60));

  const fw = b.forWhom && typeof b.forWhom === "object" ? (b.forWhom as { relation?: unknown; age?: unknown }) : null;
  if (fw) {
    const parts = [text(fw.relation, 60), text(fw.age, 40)].filter(Boolean);
    add("Para quem", parts.join(", "));
  }

  const allergies = list(b.allergies);
  if (allergies && !NO_ANSWER.test(allergies)) add("Alergias", allergies);
  const others = list(b.otherMedicines);
  if (others && !NO_ANSWER.test(others)) add("Outros remédios em uso", others);
  const tried = list(b.alreadyTried);
  if (tried && !NO_ANSWER.test(tried)) add("O que você já tentou", tried);

  // The customer's own words (red-flag or free message), when no structured symptom was collected.
  if (!symptom) add("Você escreveu", text(b.customerText, 200));

  // Product requests: the item the customer asked for (never stock, price or equivalents).
  if (reason && reason !== "symptom") {
    add("Produto que você pediu", text(b.requestedProduct ?? b.medication, 120));
  }
  return lines;
}

/** Fits greeting + lines + closing in `max` chars: drops trailing lines first, then truncates the last. */
function fit(greeting: string, lines: string[], closing: string, max: number): string {
  const assemble = (ls: string[]) => [greeting, ...(ls.length ? ["", ...ls] : []), "", closing].join("\n");
  let kept = [...lines];
  let out = assemble(kept);
  while (out.length > max && kept.length > 1) {
    kept = kept.slice(0, -1);
    out = assemble(kept);
  }
  if (out.length > max && kept.length === 1) {
    const room = max - assemble([""]).length + 0;
    const shortened = cut(kept[0], Math.max(20, room));
    out = assemble([shortened]);
  }
  if (out.length > max) out = cut(out, max);
  return out;
}

export function buildWhatsappMessage(input: WhatsappMessageInput): string {
  const customer = firstNameOf(input.customerName);
  const attendant = cut(clean(input.attendantName), 60) || "a equipe";
  const role = cut(clean(input.attendantRole), 50);
  const pharmacy = cut(clean(input.pharmacyName), 60);
  const who = [attendant, role].filter(Boolean).join(", ");
  const intro = `Aqui é ${who}${pharmacy ? ` da ${pharmacy}` : ""}.`;
  const lines = customerSummaryLines(input.brief, input.reason);
  const isQuestion = input.reason === "general_question";
  const greeting = `${customer ? `Olá, ${customer}!` : "Olá!"} ${intro} ${
    isQuestion ? `Recebi sua pergunta pelo chat${lines.length ? ":" : "."}` : `Recebi seu atendimento pelo chat${lines.length ? " e já li o que você me contou:" : "."}`
  }`;
  const closing = isQuestion ? "Vou te ajudar com isso." : "Posso te ajudar com isso?";
  const link = input.resumeLink?.trim();
  if (!link) return fit(greeting, lines, closing, MAX_WHATSAPP_MESSAGE_CHARS);
  const linkBlock = `\n\nPara continuar sua compra pelo chat: ${link}`;
  return `${fit(greeting, lines, closing, Math.max(120, MAX_WHATSAPP_MESSAGE_CHARS - linkBlock.length))}${linkBlock}`;
}

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/** "+5541998123344" / "(41) 99812-3344" -> "5541998123344" (E.164 digits, Brazilian default). null when not a phone. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (!raw.startsWith("+") && (digits.length === 10 || digits.length === 11)) return `55${digits}`;
  return digits;
}

export function buildWhatsappLinks(phone: string | null | undefined, message: string): { webUrl: string; appUrl: string; phoneDigits: string } | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  const q = encodeURIComponent(message);
  return {
    phoneDigits: digits,
    webUrl: `https://web.whatsapp.com/send?phone=${digits}&text=${q}`,
    appUrl: `https://wa.me/${digits}?text=${q}`,
  };
}

/** "+5541998123344" -> "(41) •••••-3344": enough for the attendant to recognize, never the full number. */
export function maskPhoneBr(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  const ddd = national.slice(0, 2);
  const last4 = national.slice(-4);
  return `(${ddd}) •••••-${last4}`;
}

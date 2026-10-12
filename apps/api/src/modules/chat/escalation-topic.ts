function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining marks after NFD decomposition)
    .replace(/[^a-z0-9\s]/g, " ") // strip emoji/punctuation
    .replace(/\s+/g, " ")
    .trim();
}

const ESCALATION_KEYWORDS = [
  "falar com atendente",
  "falar com um atendente",
  "falar com uma pessoa",
  "falar com alguem",
  "falar com humano",
  "atendimento humano",
  "pessoa de verdade",
  "falar com vendedor",
  "falar com corretor",
  "quero um atendente",
  "me transfere",
  "transferir para",
  "humano",
  "atendente",
  // Bare role nouns — the exact-phrase entries above miss extremely common natural insertions
  // like "falar com UM corretor" or "falar com A pessoa", which don't literally contain "falar
  // com corretor"/"falar com pessoa". Catching the role noun alone is safe here since almost any
  // mention of wanting a "corretor"/"vendedor" in a chat context signals wanting a human.
  "corretor",
  "vendedor",
];
const AFFIRMATIVE_REPLIES = ["sim", "sim por favor", "pode", "pode ser", "claro", "quero", "por favor", "ok", "okay", "isso"];

export function detectsEscalation(text: string): boolean {
  const normalized = normalize(text);
  return ESCALATION_KEYWORDS.some((kw) => normalized.includes(normalize(kw)));
}

export function confirmsEscalation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return AFFIRMATIVE_REPLIES.some((kw) => normalized === kw || normalized.startsWith(`${kw} `));
}

// Finds a usable "Assunto" for the owner email / WhatsApp deep-link prefill. `candidate` is often
// just a confirmation ("sim") typed after a prior message offered a handoff, or itself an
// escalation-request phrase ("quero falar com alguém") — neither is a usable topic. Falls back to
// the most recent earlier visitor message (from `recentVisitorTexts`, newest first) that actually
// says something substantive, so a real topic surfaces whenever one exists in the conversation.
export function resolveTopicFrom(candidate: string | null, recentVisitorTexts: string[]): string | null {
  const isSubstantive = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed.length < 8) return false;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (confirmsEscalation(trimmed) && wordCount <= 4) return false;
    if (detectsEscalation(trimmed)) return false;
    return true;
  };

  if (candidate !== null && isSubstantive(candidate)) {
    return candidate.trim().slice(0, 80);
  }

  const rejectedCandidate = candidate !== null ? candidate.trim() : null;
  for (const text of recentVisitorTexts) {
    const trimmed = String(text ?? "").trim();
    if (rejectedCandidate !== null && trimmed === rejectedCandidate) continue;
    if (isSubstantive(trimmed)) {
      return trimmed.slice(0, 80);
    }
  }

  return null;
}

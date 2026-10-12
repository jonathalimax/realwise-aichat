// Real-estate triage: the order in which Clara narrows down what a visitor wants before showing
// listings, plus the small deterministic parsers used to read a visitor's typed answer to each
// triage question. Dependency-free (no Nest/Prisma) so it can be unit-tested directly.
//
// HOW TO CHANGE THE ORDER: edit TRIAGE_ORDER below. It drives the LLM prompt fragment
// (triagePromptFragment) and nextTriageStep(); the scripted bubble flow mirrors the same order in
// flows/imobiliaria.flow.json (alugar/comprar -> triagem_regiao -> triagem_area ->
// triagem_orcamento -> resultados) — keep both in sync when reordering.

import { extractFirstMoneyCents, parseMoneyToCents } from "./money";

export type VisitorIntent = "rent" | "buy" | "questions";

export type TriageStep = "bedrooms" | "neighborhood" | "area" | "budget";

// Most important filter first. Bedrooms and location eliminate the most inventory for a family
// looking for a home; size refines; budget comes last so the visitor sees what fits their life
// before talking money (and many agencies prefer not to lead with price).
export const TRIAGE_ORDER: readonly TriageStep[] = ["bedrooms", "neighborhood", "area", "budget"];

export const TRIAGE_STEP_LABELS: Record<TriageStep, string> = {
  bedrooms: "quantidade de quartos",
  neighborhood: "bairro/região",
  area: "tamanho (m²)",
  budget: "orçamento",
};

// Area buckets (m²) used by the triagem_area bubbles ({ area: 1..4 }) and by typed answers.
export const AREA_BUCKETS: ReadonlyArray<readonly [number | null, number | null]> = [
  [null, 50],
  [50, 80],
  [80, 120],
  [120, null],
];

export interface TriagePreferences {
  transaction?: "aluguel" | "venda";
  bedrooms?: number | "any";
  neighborhood?: string | "any";
  areaMin?: number;
  areaMax?: number;
  areaAny?: boolean;
  budgetMaxCents?: number | "any";
  propertyType?: string;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RENT_WORDS = ["aluguel", "alugar", "locacao", "locar", "alugo", "aluga", "alugando"];
// "financiar" deliberately NOT here — renters ask about financing too; it's a finance signal, not intent.
const BUY_WORDS = ["comprar", "compra", "comprando", "adquirir"];

// rent/buy from explicit keywords only; null when the message states neither (never guesses).
export function detectIntent(text: string): "rent" | "buy" | null {
  const words = new Set(normalizeText(text).split(" "));
  if (RENT_WORDS.some((w) => words.has(w))) return "rent";
  if (BUY_WORDS.some((w) => words.has(w))) return "buy";
  return null;
}

export function intentToTransaction(intent: VisitorIntent | null | undefined): "aluguel" | "venda" | undefined {
  if (intent === "rent") return "aluguel";
  if (intent === "buy") return "venda";
  return undefined;
}

const ANY_PATTERN = /\b(tanto faz|qualquer|nao importa|indiferente|sem preferencia|tanto fas)\b/;

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
};

function firstSmallNumber(normalized: string): number | null {
  const digit = normalized.match(/\b(\d{1,2})\b/);
  if (digit) return Number(digit[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return value;
  }
  return null;
}

const BEDROOM_WORD = /\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis)\s*(?:ou\s+\d+\s*)?(quartos?|dormitorios?|dorms?|suites?|q)\b/;

// A bare short answer ("3", "uns 3", "2 ou 3") — longer free text must name the unit, so "quero
// alugar UMA casa" is never read as "1 quarto".
function isShortAnswer(normalized: string, maxWords = 4): boolean {
  return normalized.split(" ").filter(Boolean).length <= maxWords;
}

// Answer to "quantos quartos?" — "3", "três quartos", "2 ou 3" (takes the lower bound), "tanto faz".
export function parseBedroomsAnswer(text: string): number | "any" | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (ANY_PATTERN.test(normalized) && isShortAnswer(normalized, 5)) return "any";
  const withUnit = normalized.match(BEDROOM_WORD);
  const n = withUnit
    ? /\d/.test(withUnit[1])
      ? Number(withUnit[1])
      : NUMBER_WORDS[withUnit[1]]
    : isShortAnswer(normalized, 3)
      ? firstSmallNumber(normalized)
      : null;
  if (n == null || n < 1 || n > 10) return null;
  return n;
}

// Answer to "qual tamanho?" — "80m²", "uns 100 metros", "tanto faz".
export function parseAreaAnswer(text: string): { areaMin?: number; areaMax?: number; areaAny?: boolean } | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (ANY_PATTERN.test(normalized) && isShortAnswer(normalized, 5)) return { areaAny: true };
  const withUnit = normalized.match(/\b(\d{2,4})\s*(?:m2|m|metros?)\b/);
  const match = withUnit ?? (isShortAnswer(normalized) ? normalized.match(/\b(\d{2,4})\b/) : null);
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 10 || value > 5000) return null;
  return areaBucketRange(bucketForArea(value));
}

export function bucketForArea(value: number): number {
  const index = AREA_BUCKETS.findIndex(([min, max]) => (min == null || value >= min) && (max == null || value < max));
  return index === -1 ? AREA_BUCKETS.length : index + 1;
}

export function areaBucketRange(bucket: unknown): { areaMin?: number; areaMax?: number } {
  const index = typeof bucket === "number" ? bucket : typeof bucket === "string" ? Number(bucket) : NaN;
  const range = Number.isInteger(index) ? AREA_BUCKETS[index - 1] : undefined;
  if (!range) return {};
  const [min, max] = range;
  return { ...(min != null ? { areaMin: min } : {}), ...(max != null ? { areaMax: max } : {}) };
}

// Answer to "até quanto quer pagar?". A bare number for a purchase below R$ 10 mil almost always
// means thousands ("500" -> R$ 500 mil); for rent a bare number is taken literally (R$/mês).
export function parseBudgetAnswer(text: string, transaction?: "aluguel" | "venda"): number | "any" | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (ANY_PATTERN.test(normalized) && isShortAnswer(normalized, 5)) return "any";
  let cents = extractFirstMoneyCents(text);
  if (cents == null) {
    // A bare number only counts as a budget in a short answer ("3000", "uns 2500").
    if (!isShortAnswer(normalized)) return null;
    const bare = text.match(/\b\d+(?:[.,]\d+)?\b/);
    if (!bare) return null;
    cents = parseMoneyToCents(bare[0]);
    if (cents == null) return null;
  }
  const saysThousands =
    /\b(mil|k|mi|milhao|milhoes)\b/.test(normalized) || /\d\s*k\b/.test(text.toLowerCase());
  if (transaction === "venda" && !saysThousands && cents < 10_000_00) cents *= 1000;
  return cents;
}

const NOT_A_PLACE = /^(sim|nao|ok|okay|obrigad[oa]|valeu|oi|ola|blz|beleza|pode ser|talvez|nao sei|qualquer um)$/;
// "no Centro", "bairro Batel", "pode ser na Zona Sul" — an explicit place marker before the name.
const EXPLICIT_PLACE = /(?:^|\b(?:pode ser|prefiro|quero|seria)\s+)(?:no|na|nos|nas|em|bairro|regi[aã]o)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ]{1,40})$/i;

// Answer to "qual bairro/região?". Accepted only when it is clearly a place: it matches one of the
// business's real neighborhoods/regions (`known`), or names a place with an explicit marker
// ("no Centro"). Anything else ("me mostra as opções", "aceita pet") falls through to bubble
// matching / the LLM instead of silently becoming a neighborhood filter.
export function parseNeighborhoodAnswer(text: string, known: readonly string[] = []): string | "any" | null {
  const trimmed = text.trim().replace(/[.!]+$/, "");
  if (!trimmed || trimmed.endsWith("?")) return null;
  const normalized = normalizeText(trimmed);
  if (/\bperto de mim\b/.test(normalized)) return "any";
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 6) return null;
  if (ANY_PATTERN.test(normalized)) return "any";
  if (NOT_A_PLACE.test(normalized)) return null;
  // "não quero no centro" is a rejection, not a preference.
  if (/\b(nao|nunca|menos)\b/.test(normalized)) return null;
  const other = extractPreferencesFromText(trimmed);
  if (other.bedrooms !== undefined || other.budgetMaxCents !== undefined || other.areaMin !== undefined || other.areaMax !== undefined) return null;

  const padded = ` ${normalized} `;
  const knownMatch = known.find((name) => {
    const n = normalizeText(name);
    return n.length >= 3 && (padded.includes(` ${n} `) || n === normalized);
  });
  if (knownMatch) return knownMatch;

  const explicit = trimmed.match(EXPLICIT_PLACE);
  if (explicit) {
    const place = explicit[1].trim();
    // "na verdade…", "no momento…" are filler, not places.
    if (/^(verdade|momento|caso|hora|geral|final|fundo|maximo|minimo)\b/.test(normalizeText(place))) return null;
    return place.length >= 2 ? place : null;
  }
  return null;
}

// Pulls whatever filters a free-text message already states, so Clara never re-asks something
// the visitor said ("quero alugar uma casa de 3 quartos no Centro até 3 mil").
export function extractPreferencesFromText(text: string): TriagePreferences {
  const normalized = normalizeText(text);
  const prefs: TriagePreferences = {};
  const intent = detectIntent(text);
  if (intent === "rent") prefs.transaction = "aluguel";
  if (intent === "buy") prefs.transaction = "venda";

  const bedrooms = normalized.match(/\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco)\s*(quartos?|dormitorios?|dorms?|suites?)\b/);
  if (bedrooms) {
    const value = /\d/.test(bedrooms[1]) ? Number(bedrooms[1]) : NUMBER_WORDS[bedrooms[1]];
    if (value >= 1 && value <= 10) prefs.bedrooms = value;
  }

  const area = normalized.match(/\b(\d{2,4})\s*(m2|m|metros?)\b/);
  if (area) Object.assign(prefs, areaBucketRange(bucketForArea(Number(area[1]))));

  const hasBudgetCue = /\b(orcamento|ate|maximo|no maximo|budget|por mes|mensal)\b/.test(normalized);
  if (hasBudgetCue) {
    const cents = extractFirstMoneyCents(text);
    if (cents != null) prefs.budgetMaxCents = cents;
  }

  const neighborhood = text.match(/\b(?:bairro|regi[aã]o)\s+(?:do |da |de )?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,30}?)(?=[,.!?]|\s+(?:com|at[eé]|de|e|para|pra)(?:\s|$)|$)/i);
  if (neighborhood) prefs.neighborhood = neighborhood[1].trim();

  return prefs;
}

export function mergePreferences(base: TriagePreferences, update: TriagePreferences): TriagePreferences {
  const merged: TriagePreferences = { ...base };
  for (const [key, value] of Object.entries(update) as [keyof TriagePreferences, unknown][]) {
    if (value !== undefined && value !== null && value !== "") (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function hasStep(prefs: TriagePreferences, step: TriageStep): boolean {
  switch (step) {
    case "bedrooms":
      return prefs.bedrooms !== undefined;
    case "neighborhood":
      return prefs.neighborhood !== undefined;
    case "area":
      return prefs.areaAny === true || prefs.areaMin !== undefined || prefs.areaMax !== undefined;
    case "budget":
      return prefs.budgetMaxCents !== undefined;
  }
}

export function nextTriageStep(prefs: TriagePreferences): TriageStep | null {
  return TRIAGE_ORDER.find((step) => !hasStep(prefs, step)) ?? null;
}

export function triageQuestion(step: TriageStep, transaction?: "aluguel" | "venda"): string {
  switch (step) {
    case "bedrooms":
      return "Quantos quartos você precisa?";
    case "neighborhood":
      return "Em qual bairro ou região você prefere?";
    case "area":
      return "E de tamanho, mais ou menos quantos m² você procura?";
    case "budget":
      return transaction === "venda"
        ? "Pra fechar: até quanto você pretende investir no imóvel?"
        : "Pra fechar: até quanto você quer pagar de aluguel por mês?";
  }
}

export function formatCentsBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Human-readable preference list for prompts, the team summary and "waiting for" notes.
export function describePreferences(prefs: TriagePreferences): string {
  const parts: string[] = [];
  if (prefs.transaction) parts.push(prefs.transaction === "venda" ? "compra" : "aluguel");
  if (prefs.propertyType && prefs.propertyType !== "any") parts.push(prefs.propertyType);
  if (typeof prefs.bedrooms === "number") parts.push(`${prefs.bedrooms}+ quarto${prefs.bedrooms === 1 ? "" : "s"}`);
  if (typeof prefs.neighborhood === "string" && prefs.neighborhood !== "any") parts.push(prefs.neighborhood);
  if (prefs.areaMin != null && prefs.areaMax != null) parts.push(`${prefs.areaMin}–${prefs.areaMax} m²`);
  else if (prefs.areaMin != null) parts.push(`acima de ${prefs.areaMin} m²`);
  else if (prefs.areaMax != null) parts.push(`até ${prefs.areaMax} m²`);
  if (typeof prefs.budgetMaxCents === "number") {
    parts.push(`até ${formatCentsBRL(prefs.budgetMaxCents)}${prefs.transaction === "aluguel" ? "/mês" : ""}`);
  }
  return parts.join(", ");
}

// Appended to Clara's system prompt (imobiliária only). Encodes the assertive-triage behavior:
// never answer a rent/buy intent with "o que você quer saber?", ask the single most important
// missing filter (in TRIAGE_ORDER), never re-ask what's already known, show a short subset.
export function triagePromptFragment(intent: VisitorIntent | null | undefined, prefs: TriagePreferences): string {
  const known = describePreferences(prefs);
  const next = nextTriageStep(prefs);
  const lines = [
    "Triagem (regra de atendimento): quando o cliente disser que quer alugar ou comprar um imóvel, NUNCA responda com perguntas genéricas como 'o que você quer saber?'. Confirme que vai ajudar, assuma a condução e faça a triagem com UMA pergunta por vez, nesta ordem de importância: " +
      TRIAGE_ORDER.map((s, i) => `${i + 1}) ${TRIAGE_STEP_LABELS[s]}`).join(", ") +
      ". Nunca pergunte de novo algo que o cliente já informou.",
    "Nunca despeje o portfólio inteiro: mostre poucas opções filtradas e ofereça refinar ou escolher uma.",
    intent === "buy"
      ? "O cliente quer COMPRAR: quando fizer sentido (depois de mostrar opções ou quando ele escolher um imóvel), ofereça de forma leve simular o financiamento ou tirar dúvidas sobre crédito/FGTS."
      : intent === "rent"
        ? "O cliente quer ALUGAR: fale em valor mensal (aluguel + condomínio + IPTU quando disponíveis) e garantias de locação quando fizer sentido."
        : "Se o cliente demonstrar interesse em imóveis mas ainda não estiver claro se quer alugar ou comprar, pergunte isso de forma direta — mas sempre responda antes qualquer pergunta específica que ele tenha feito.",
  ];
  if (known) lines.push(`Preferências já informadas pelo cliente nesta conversa: ${known}.`);
  if (next && (intent === "rent" || intent === "buy")) {
    lines.push(`Próxima informação mais importante que ainda falta: ${TRIAGE_STEP_LABELS[next]}. Se a mensagem do cliente não for uma pergunta específica, termine sua resposta perguntando isso.`);
  }
  return lines.join("\n");
}

// Scripted-flow node that asks each triage question (flows/imobiliaria.flow.json). The bedrooms
// question lives on the rent/buy entry nodes themselves so the very first reply to "quero alugar"
// is already a triage question.
export const TRIAGE_NODE_IDS = new Set(["alugar", "comprar", "triagem_regiao", "triagem_area", "triagem_orcamento"]);
export const TRIAGE_START_NODE_ID = "triagem_inicio";

export function triageNodeForStep(step: TriageStep | null, transaction?: "aluguel" | "venda"): string {
  switch (step) {
    case "bedrooms":
      return transaction === "venda" ? "comprar" : "alugar";
    case "neighborhood":
      return "triagem_regiao";
    case "area":
      return "triagem_area";
    case "budget":
      return "triagem_orcamento";
    default:
      return "resultados";
  }
}

export function triageStepForNode(nodeId: string | null | undefined): TriageStep | null {
  switch (nodeId) {
    case "alugar":
    case "comprar":
      return "bedrooms";
    case "triagem_regiao":
      return "neighborhood";
    case "triagem_area":
      return "area";
    case "triagem_orcamento":
      return "budget";
    default:
      return null;
  }
}

// Flow params (bubble taps accumulate these in Conversation.flowParams) -> triage preferences.
// `faixaToCents` converts the legacy numbered price bucket (busca_preco/triagem_orcamento bubbles)
// to a ceiling; it lives in FlowService because the bucket table does.
export function preferencesFromParams(
  params: Record<string, unknown>,
  faixaToCents?: (faixa: unknown, transaction?: "aluguel" | "venda") => number | null,
): TriagePreferences {
  const prefs: TriagePreferences = {};
  if (params.modo === "aluguel" || params.modo === "venda") prefs.transaction = params.modo;
  if (params.quartos === "any") prefs.bedrooms = "any";
  else if (typeof params.quartos === "number" && params.quartos > 0) prefs.bedrooms = params.quartos;
  if (params.regiao === "any") prefs.neighborhood = "any";
  else if (typeof params.regiao === "string" && params.regiao && params.regiao !== "geo") prefs.neighborhood = params.regiao;
  if (params.area === "any") prefs.areaAny = true;
  else if (params.area !== undefined) Object.assign(prefs, areaBucketRange(params.area));
  if (typeof params.area_min === "number") prefs.areaMin = params.area_min;
  if (typeof params.area_max === "number") prefs.areaMax = params.area_max;
  if (typeof params.orcamento_max === "number" && params.orcamento_max > 0) prefs.budgetMaxCents = params.orcamento_max;
  else if (params.orcamento_max === "any" || params.faixa === "any") prefs.budgetMaxCents = "any";
  else if (params.faixa !== undefined && faixaToCents) {
    const cents = faixaToCents(params.faixa, prefs.transaction);
    prefs.budgetMaxCents = cents ?? "any";
  }
  if (typeof params.tipo === "string" && params.tipo !== "any") prefs.propertyType = params.tipo;
  return prefs;
}

// Inverse of preferencesFromParams for typed triage answers.
export function paramsFromPreferences(prefs: TriagePreferences): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (prefs.transaction) params.modo = prefs.transaction;
  if (prefs.bedrooms !== undefined) params.quartos = prefs.bedrooms;
  if (prefs.neighborhood !== undefined) params.regiao = prefs.neighborhood;
  if (prefs.areaAny) params.area = "any";
  if (prefs.areaMin !== undefined) params.area_min = prefs.areaMin;
  if (prefs.areaMax !== undefined) params.area_max = prefs.areaMax;
  if (prefs.budgetMaxCents !== undefined) {
    params.orcamento_max = prefs.budgetMaxCents;
    // A typed budget replaces any earlier bucket choice.
    params.faixa = undefined;
  }
  return params;
}

// Refers to something already selected ("esse", "quanto fica o aluguel desse?") — answered about
// the selection, never by restarting the search.
const SELECTION_REFERENCE_PATTERN = /\b(esse|essa|desse|dessa|deste|desta|este|esta|nesse|nessa|selecionei|selecionado|selecionada|escolhi)\b/;
const COST_WORDS_PATTERN = /\b(total|pacote|custa|custo|custos|valor|pagaria|pagar|taxas?)\b/;

// Questions about rental/purchase rules ("quero alugar, aceita pet?") are FAQ questions, not a
// request to start searching — those keep going to the knowledge-base answer path.
const FAQ_TOPIC_PATTERN = /\b(garantia|fiador|caucao|seguro fianca|documento|documentos|documentacao|contrato|pet|pets|animal|renda|fgts|financiamento|financiar|iptu|condominio|multa|reajuste|taxa|taxas|itbi|escritura|visita|agendar|horario)\b/;

// "Quero alugar uma casa", "vocês têm apartamento pra comprar?" -> start triage.
export function isTriageEntry(text: string): boolean {
  if (!detectIntent(text)) return false;
  const normalized = normalizeText(text);
  if (FAQ_TOPIC_PATTERN.test(normalized)) return false;
  if (SELECTION_REFERENCE_PATTERN.test(normalized)) return false;
  if (COST_WORDS_PATTERN.test(normalized)) return false;
  return true;
}

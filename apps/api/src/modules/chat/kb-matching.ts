// Keyword matching for the knowledge base when no embeddings are available (or none matched).
// Pure functions: lowercase, accent-free, light pt-BR stemming (plural / diminutive / noun and verb endings),
// a very small synonym table and token-overlap scoring. Deliberately conservative: "cachorro" never
// matches "animais", but "estacionamento" matches "estacionar" and "estacionamentos".

const STOPWORDS = new Set([
  "para", "pela", "pelo", "pelas", "pelos", "como", "qual", "quais", "quando", "onde", "quanto", "quanta", "quantos", "quantas",
  "voce", "voces", "vcs", "tem", "tenho", "temos", "esse", "essa", "esses", "essas", "isso", "este", "esta", "estes", "estas",
  "aqui", "sobre", "gostaria", "queria", "quero", "saber", "preciso", "pode", "podem", "seria", "seu", "sua",
  "seus", "suas", "meu", "minha", "mais", "menos", "muito", "tambem", "ainda", "entao", "porque", "que",
  "informacao", "informacoes", "duvida", "favor", "obrigado", "obrigada", "bom", "boa", "uma", "uns", "umas", "com", "sem",
  "nos", "nas", "dos", "das", "num", "numa", "por", "mas", "ola", "oi", "ai", "farmacia", "voces", "tem",
  "pergunta", "resposta", "posso", "podemos", "possivel", "algum", "alguma", "alguns", "algumas", "tipo", "hoje", "agora", "existe", "tudo",
]);

// Canonical groups: every member stems to the group's first word. Kept tiny on purpose: never group things a customer
// could mean differently (Pix vs cartão, one health plan vs another), a wrong "yes" is worse than escalating.
const SYNONYM_GROUPS: string[][] = [
  ["remedio", "medicamento", "medicacao"],
  ["entrega", "delivery", "motoboy", "entregar"],
  ["pagamento", "pagar"],
  ["horario", "funcionamento", "abre", "fecha", "aberto", "fechado", "expediente"],
  ["estacionamento", "estacionar"],
  ["desconto", "promocao", "oferta", "cupom"],
  ["convenio", "convenios"],
  ["troca", "devolucao", "devolver", "trocar"],
  ["notafiscal", "nfe", "recibo"],
];

const SYNONYM_OF = new Map<string, string>();
for (const group of SYNONYM_GROUPS) for (const w of group) SYNONYM_OF.set(w, group[0]);

export function foldText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Longest suffix first. A suffix is only removed when 4+ letters remain.
const SUFFIXES = [
  "zinhos", "zinhas", "zinho", "zinha", "inhos", "inhas", "inho", "inha",
  "amentos", "imentos", "amento", "imento",
  "acoes", "icoes", "acao", "icao",
  "adores", "adoras", "ador", "adora",
  "mente", "idade", "idades",
  "aram", "eram", "iram", "ando", "endo", "indo", "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida",
  "oes", "aes", "ais", "eis", "ois", "res", "zes", "ns",
  "ar", "er", "ir", "or", "es", "as", "os", "a", "o", "e", "s",
];

export function stem(word: string): string {
  let w = foldText(word);
  if (w.length <= 3) return w;
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      w = w.slice(0, w.length - suf.length);
      break;
    }
  }
  return w;
}

const SYNONYM_STEMS = new Map<string, string>();
for (const [word, canon] of SYNONYM_OF) SYNONYM_STEMS.set(stem(word), stem(canon));

/** Distinct, stemmed, synonym-normalised significant tokens of a text. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of foldText(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const s = stem(raw);
    if (s.length < 3) continue;
    out.push(SYNONYM_STEMS.get(s) ?? s);
  }
  return [...new Set(out)];
}

export interface KeywordScore {
  /** 0..1: weighted share of the question's tokens found in the chunk. */
  score: number;
  matched: number;
  total: number;
  /** Length of the longest matched token (a long stem is a distinctive topic word). */
  longest: number;
}

export function scoreChunk(queryTokens: string[], content: string): KeywordScore {
  if (queryTokens.length === 0) return { score: 0, matched: 0, total: 0, longest: 0 };
  const chunk = new Set(tokenize(content));
  let weight = 0;
  let got = 0;
  let matched = 0;
  let longest = 0;
  for (const t of queryTokens) {
    const w = Math.min(t.length, 10);
    weight += w;
    if (chunk.has(t)) {
      got += w;
      matched += 1;
      longest = Math.max(longest, t.length);
    }
  }
  return { score: weight ? got / weight : 0, matched, total: queryTokens.length, longest };
}

/**
 * At least 2 of the question's own tokens, so one generic word never grounds an answer. The exception: a single
 * matched word that is long and distinctive ("brinquedoteca", "estacionamento"); the model still decides whether the chunk answers.
 */
export function isKeywordHit(s: KeywordScore): boolean {
  if (s.matched === 0) return false;
  if (s.matched >= Math.min(2, s.total)) return true;
  return s.longest >= 8;
}

/** Rank chunks by keyword overlap; only real hits are returned, best first. */
export function rankByKeywords<T extends { content: string }>(queryText: string, chunks: T[], limit = 5): Array<T & { score: number }> {
  const q = tokenize(queryText);
  return chunks
    .map((c) => ({ c, s: scoreChunk(q, c.content) }))
    .filter((x) => isKeywordHit(x.s))
    .sort((a, b) => b.s.score - a.s.score)
    .slice(0, limit)
    .map((x) => ({ ...x.c, score: x.s.score }));
}

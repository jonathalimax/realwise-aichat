import { PrismaService } from "../../prisma/prisma.service";
import { embedText } from "../../inference/embed-client";
import { rankByKeywords, scoreChunk, tokenize } from "./kb-matching";

const RESULT_LIMIT = 5;

// Cosine-distance ceiling for vector hits — rows past this are semantically unrelated to the
// query (e.g. a generic "sobre a loja" chunk surfacing for a specific model question) and merging
// them in gives the LLM just enough vague context to hallucinate a confident-sounding answer
// (answerSource="rag") instead of abstaining. Full-text rows are exact keyword matches by
// construction and are never filtered by this floor.
const MAX_VECTOR_DISTANCE = 0.55;

// Hybrid retrieval: vector cosine-distance (semantic) + Postgres full-text (exact keyword/proper-noun
// matches vector search can miss, e.g. a specific model name or street) — both are plain SQL, no extra
// LLM call, so this doesn't add to the CPU-inference capacity problem. Vector hits are prioritized;
// full-text fills remaining slots up to the same total limit as the old vector-only query.
export type RetrievedChunk = { id: string; content: string; score?: number };

// Accent-folding for the keyword fallback below. Postgres' 'portuguese' text-search config stems
// but does not strip accents, so a visitor typing "condominio" (very common on mobile) never
// matches a document saying "condomínio". translate() is built in — no extension/migration needed.
const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüç";
const UNACCENTED = "aaaaaeeeeiiiiooooouuuuc";
const FALLBACK_RESULT_LIMIT = 3;
// Fetched before the minimum-keyword filter, so listing-word-only hits can't crowd out a real one.
const FALLBACK_CANDIDATES = 10;

// Words that carry no topical signal for the OR-keyword fallback (they'd match almost any chunk).
const FALLBACK_STOPWORDS = new Set([
  "para", "pela", "pelo", "como", "qual", "quais", "quando", "onde", "quanto", "quanta", "quantos", "quantas",
  "voce", "voces", "vcs", "tem", "tenho", "temos", "esse", "essa", "esses", "essas", "isso", "este", "esta",
  "aqui", "sobre", "gostaria", "queria", "quero", "saber", "preciso", "pode", "podem", "seria", "seu", "sua",
  "seus", "suas", "meu", "minha", "mais", "menos", "muito", "tambem", "ainda", "entao", "porque", "que",
  "imovel", "imoveis", "informacao", "informacoes", "duvida", "favor", "obrigado", "obrigada", "bom", "boa",
]);

function foldAccents(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Significant, accent-folded keywords of a query, for the OR fallback.
export function fallbackKeywords(queryText: string): string[] {
  const words = foldAccents(queryText)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !FALLBACK_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

// Common pt-BR chat abbreviations, expanded only for retrieval (never shown or stored).
const ABBREVIATIONS: Record<string, string> = {
  vc: "você", vcs: "vocês", qnto: "quanto", qto: "quanto", qnt: "quanto", qnts: "quantos", qts: "quartos",
  tb: "também", tbm: "também", ap: "apartamento", apto: "apartamento", aptos: "apartamentos",
  cond: "condomínio", pq: "porque", oq: "o que", hj: "hoje", msm: "mesmo", dorm: "dormitório", dorms: "dormitórios",
  info: "informação", infos: "informações", doc: "documento", docs: "documentos", fin: "financiamento",
};

export function expandAbbreviations(text: string): string {
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => ABBREVIATIONS[word.toLowerCase()] ?? word);
}

// Conversation-aware retrieval query. A short follow-up that isn't a question on its own terms
// ("para entrada", "e o de 3 quartos") borrows the two previous turns; a self-contained question
// ("Qual o valor do condomínio?") never does — confirmed live regression: augmenting a complete
// question with unrelated history skewed retrieval toward a different topic. The listing in focus
// always contributes its summary so "desse imóvel" retrieves chunks about that listing.
// `recentTextsNewestFirst` excludes the current visitor message.
const SHORT_FOLLOW_UP_CHARS = 30;
export function buildRetrievalQuery(visitorText: string, recentTextsNewestFirst: string[], contextListingSummary: string | null): string {
  const expanded = expandAbbreviations(visitorText.trim());
  const isShortFollowUp = expanded.length < SHORT_FOLLOW_UP_CHARS && !/\?\s*$/.test(expanded);
  const history = isShortFollowUp ? recentTextsNewestFirst.slice(0, 2).reverse().join(" ") : "";
  return [history, expanded, contextListingSummary].filter(Boolean).join(" ");
}

// `keywords.text`: what the keyword paths (AND full-text + accent-folded fallback) search for.
// Defaults to queryText; chat passes the visitor's own words here, because the conversation-
// augmented queryText (history + listing summary) helps the vector search but makes an AND query
// almost never match and drowns the actual question's keywords ("e o iptu?").
// `keywords.extra`: secondary words (e.g. the listing in focus) that may help rank fallback hits
// but never count toward the minimum match.
export interface KeywordOptions {
  text?: string;
  extra?: string | null;
}

export async function retrieveRelevantChunks(
  prisma: PrismaService,
  businessId: string,
  queryText: string,
  keywordOptions: KeywordOptions = {},
): Promise<RetrievedChunk[]> {
  const keywordText = keywordOptions.text ?? queryText;
  let vectorRows: { id: string; content: string; distance: number }[] = [];
  try {
    const embedding = await embedText(queryText);
    vectorRows = await prisma.client.$queryRawUnsafe<{ id: string; content: string; distance: number }[]>(
      `SELECT id, content, embedding <=> $2::vector AS distance FROM "KnowledgeChunk"
       WHERE "businessId" = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      businessId,
      `[${embedding.join(",")}]`,
      RESULT_LIMIT,
    );
  } catch {
    vectorRows = []; // embedding/DB hiccup — full-text query below can still contribute
  }

  let fullTextRows: { id: string; content: string; rank: number }[] = [];
  try {
    fullTextRows = await prisma.client.$queryRawUnsafe<{ id: string; content: string; rank: number }[]>(
      `SELECT id, content, ts_rank(to_tsvector('portuguese', content), websearch_to_tsquery('portuguese', $2)) AS rank FROM "KnowledgeChunk"
       WHERE "businessId" = $1 AND to_tsvector('portuguese', content) @@ websearch_to_tsquery('portuguese', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      businessId,
      keywordText,
      RESULT_LIMIT,
    );
  } catch {
    fullTextRows = []; // malformed query (e.g. empty/punctuation-only text) — vector results still stand
  }

  // cosine distance: lower is more similar, so convert to a 0-1-ish similarity score for storage.
  // Rows past MAX_VECTOR_DISTANCE are too semantically loose to ground an answer on — drop them
  // before merging rather than letting them pad out the context the LLM sees. Full-text rows are
  // exact keyword matches by construction (high precision) and are kept unfiltered.
  const merged: RetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const row of [
    ...vectorRows
      .filter((r) => r.distance <= MAX_VECTOR_DISTANCE)
      .map((r) => ({ id: r.id, content: r.content, score: Math.max(0, Math.min(1, 1 - r.distance)) })),
    ...fullTextRows.map((r) => ({ id: r.id, content: r.content, score: Math.max(0, Math.min(1, r.rank)) })),
  ]) {
    if (seen.has(row.content)) continue;
    seen.add(row.content);
    merged.push(row);
    if (merged.length >= RESULT_LIMIT) break;
  }
  if (merged.length > 0) {
    // Keyword-only mode (no vectors): order the hits by token overlap so the most on-topic chunk comes first.
    if (vectorRows.length === 0 && merged.length > 1) {
      const q = tokenize(keywordText);
      const scored = merged.map((m, i) => ({ m, i, s: scoreChunk(q, m.content).score }));
      scored.sort((a, b) => b.s - a.s || a.i - b.i);
      return scored.map((x) => x.m);
    }
    return merged;
  }

  // Recall fallback, only when both precise paths found nothing (e.g. embeddings down AND the
  // AND-semantics keyword query missed because of a missing accent or an extra word): accent-folded
  // keywords OR'ed together, top 3 by rank. Scoped by businessId like everything else; runs without
  // the GIN index, which is fine for one tenant's chunks and only on this miss path.
  const primary = fallbackKeywords(keywordText);
  let sqlFallback: RetrievedChunk[] = [];
  if (primary.length > 0) {
    const keywords = [...new Set([...primary, ...fallbackKeywords(keywordOptions.extra ?? "")])].slice(0, 8);
    try {
      const rows = await prisma.client.$queryRawUnsafe<{ id: string; content: string; rank: number }[]>(
        `SELECT id, content, ts_rank(to_tsvector('portuguese', translate(lower(content), $4, $5)), websearch_to_tsquery('portuguese', $2)) AS rank FROM "KnowledgeChunk"
         WHERE "businessId" = $1 AND to_tsvector('portuguese', translate(lower(content), $4, $5)) @@ websearch_to_tsquery('portuguese', $2)
         ORDER BY rank DESC
         LIMIT $3`,
        businessId,
        keywords.join(" or "),
        FALLBACK_CANDIDATES,
        ACCENTED,
        UNACCENTED,
      );
      // OR semantics would let one generic shared word "ground" an unrelated chunk (and bypass the
      // zero-context gap gate). Require the chunk to contain at least 2 of the question's own
      // keywords (or the only one, for a one-keyword question), stem-tolerant.
      const required = Math.min(2, primary.length);
      sqlFallback = rows
        .filter((r) => {
          const content = foldAccents(r.content);
          return primary.filter((w) => content.includes(w.length > 5 ? w.slice(0, w.length - 2) : w)).length >= required;
        })
        .slice(0, FALLBACK_RESULT_LIMIT)
        .map((r) => ({ id: r.id, content: r.content, score: Math.max(0, Math.min(1, r.rank)) }));
    } catch {
      sqlFallback = [];
    }
  }
  if (sqlFallback.length > 0) return sqlFallback;
  return keywordScan(prisma, businessId, keywordText);
}

// Last resort, in process: stem-aware token overlap over this tenant's chunks ("estacionamento" finds "estacionar",
// plurals and diminutives fold together, accents never matter). Works with no embeddings and no Postgres text search.
const SCAN_CHUNK_LIMIT = 2000;
async function keywordScan(prisma: PrismaService, businessId: string, queryText: string): Promise<RetrievedChunk[]> {
  if (tokenize(queryText).length === 0) return [];
  try {
    const rows = (await prisma.client.knowledgeChunk.findMany({
      where: { businessId },
      select: { id: true, content: true },
      take: SCAN_CHUNK_LIMIT,
    })) as { id: string; content: string }[];
    return rankByKeywords(queryText, rows, FALLBACK_RESULT_LIMIT).map((r) => ({ id: r.id, content: r.content, score: r.score }));
  } catch {
    return [];
  }
}

// Shared/global knowledge tier (Stage 2b) — general domain content (rental/vehicle law,
// financing basics, documentation) that is NOT specific to any one tenant, scoped only by
// niche. Stricter distance ceiling and a smaller cap than tenant retrieval: this content should
// only ever fill in general/definitional/legal gaps, never crowd out or outweigh a tenant's own
// documents.
const SHARED_RESULT_LIMIT = 2;
const SHARED_MAX_VECTOR_DISTANCE = 0.45;

export type SharedRetrievedChunk = RetrievedChunk & { sourceCitation?: string | null };

export async function retrieveSharedChunks(
  prisma: PrismaService,
  niche: string,
  queryText: string,
): Promise<SharedRetrievedChunk[]> {
  let vectorRows: { id: string; content: string; distance: number; sourceCitation: string | null }[] = [];
  try {
    const embedding = await embedText(queryText);
    vectorRows = await prisma.client.$queryRawUnsafe<
      { id: string; content: string; distance: number; sourceCitation: string | null }[]
    >(
      `SELECT sc.id, sc.content, sc.embedding <=> $2::vector AS distance, sd."sourceCitation" AS "sourceCitation"
       FROM "SharedKnowledgeChunk" sc
       JOIN "SharedKnowledgeDocument" sd ON sd.id = sc."documentId"
       WHERE sc.niche = $1 AND sc.embedding IS NOT NULL AND sd."isActive" = true
       ORDER BY sc.embedding <=> $2::vector
       LIMIT $3`,
      niche,
      `[${embedding.join(",")}]`,
      SHARED_RESULT_LIMIT,
    );
  } catch {
    vectorRows = [];
  }

  let fullTextRows: { id: string; content: string; rank: number; sourceCitation: string | null }[] = [];
  try {
    fullTextRows = await prisma.client.$queryRawUnsafe<
      { id: string; content: string; rank: number; sourceCitation: string | null }[]
    >(
      `SELECT sc.id, sc.content,
              ts_rank(to_tsvector('portuguese', sc.content), websearch_to_tsquery('portuguese', $2)) AS rank,
              sd."sourceCitation" AS "sourceCitation"
       FROM "SharedKnowledgeChunk" sc
       JOIN "SharedKnowledgeDocument" sd ON sd.id = sc."documentId"
       WHERE sc.niche = $1 AND sd."isActive" = true
         AND to_tsvector('portuguese', sc.content) @@ websearch_to_tsquery('portuguese', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      niche,
      queryText,
      SHARED_RESULT_LIMIT,
    );
  } catch {
    fullTextRows = [];
  }

  const merged: SharedRetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const row of [
    ...vectorRows
      .filter((r) => r.distance <= SHARED_MAX_VECTOR_DISTANCE)
      .map((r) => ({
        id: r.id,
        content: r.content,
        score: Math.max(0, Math.min(1, 1 - r.distance)),
        sourceCitation: r.sourceCitation,
      })),
    ...fullTextRows.map((r) => ({
      id: r.id,
      content: r.content,
      score: Math.max(0, Math.min(1, r.rank)),
      sourceCitation: r.sourceCitation,
    })),
  ]) {
    if (seen.has(row.content)) continue;
    seen.add(row.content);
    merged.push(row);
    if (merged.length >= SHARED_RESULT_LIMIT) break;
  }
  return merged;
}

// Combines tenant-scoped retrieval (unchanged, byte-for-byte via retrieveRelevantChunks above)
// with the new shared/global tier — tenant chunks fill their slots first and are never evicted
// by shared chunks; shared chunks only ever add up to 2 more, niche-gated so one niche's shared
// hit can never surface for a different niche's conversation.
export async function retrieveChunksForChat(
  prisma: PrismaService,
  businessId: string,
  niche: string,
  queryText: string,
  keywordOptions: KeywordOptions = {},
): Promise<{ tenant: RetrievedChunk[]; shared: SharedRetrievedChunk[] }> {
  const [tenant, shared] = await Promise.all([
    retrieveRelevantChunks(prisma, businessId, queryText, keywordOptions),
    retrieveSharedChunks(prisma, niche, queryText),
  ]);
  return { tenant, shared };
}

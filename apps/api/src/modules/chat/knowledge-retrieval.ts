import { PrismaService } from "../../prisma/prisma.service";
import { embedText } from "../../inference/embed-client";

const RESULT_LIMIT = 5;

// Hybrid retrieval: vector cosine-distance (semantic) + Postgres full-text (exact keyword/proper-noun
// matches vector search can miss, e.g. a specific model name or street) — both are plain SQL, no extra
// LLM call, so this doesn't add to the CPU-inference capacity problem. Vector hits are prioritized;
// full-text fills remaining slots up to the same total limit as the old vector-only query.
export type RetrievedChunk = { id: string; content: string; score?: number };

export async function retrieveRelevantChunks(
  prisma: PrismaService,
  businessId: string,
  queryText: string,
): Promise<RetrievedChunk[]> {
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

  let fullTextRows: { id: string; content: string }[] = [];
  try {
    fullTextRows = await prisma.client.$queryRawUnsafe<{ id: string; content: string }[]>(
      `SELECT id, content FROM "KnowledgeChunk"
       WHERE "businessId" = $1 AND to_tsvector('portuguese', content) @@ websearch_to_tsquery('portuguese', $2)
       ORDER BY ts_rank(to_tsvector('portuguese', content), websearch_to_tsquery('portuguese', $2)) DESC
       LIMIT $3`,
      businessId,
      queryText,
      RESULT_LIMIT,
    );
  } catch {
    fullTextRows = []; // malformed query (e.g. empty/punctuation-only text) — vector results still stand
  }

  // cosine distance: lower is more similar, so convert to a 0-1-ish similarity score for storage.
  const merged: RetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const row of [
    ...vectorRows.map((r) => ({ id: r.id, content: r.content, score: 1 - r.distance })),
    ...fullTextRows.map((r) => ({ id: r.id, content: r.content, score: undefined })),
  ]) {
    if (seen.has(row.content)) continue;
    seen.add(row.content);
    merged.push(row);
    if (merged.length >= RESULT_LIMIT) break;
  }
  return merged;
}

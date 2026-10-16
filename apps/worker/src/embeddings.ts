const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
// nomic-embed-text's context window is ~2048 tokens (~4 chars/token); stay well under that
// regardless of how the chunk was produced, so a malformed source never 500s the whole job.
const MAX_PROMPT_CHARS = 6000;

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, MAX_PROMPT_CHARS) }),
    // CPU-bound inference on a small/shared VPS genuinely takes 10-30s+ per call depending on
    // input length (measured ~27s for a full 6000-char chunk in production) — combined with
    // queue concurrency this was still timing out at 60s. 120s leaves real margin.
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

let embedderDownUntil = 0;
const EMBEDDER_COOLDOWN_MS = 60_000;

/**
 * Embedding or null when the embedder is not available (not configured locally, down, slow). Ingestion never fails
 * because of it: chunks are stored without a vector and retrieval falls back to keyword matching.
 */
export async function tryEmbedText(text: string): Promise<number[] | null> {
  if (Date.now() < embedderDownUntil) return null;
  try {
    return await embedText(text);
  } catch {
    embedderDownUntil = Date.now() + EMBEDDER_COOLDOWN_MS;
    return null;
  }
}

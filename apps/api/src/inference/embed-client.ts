const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const MAX_PROMPT_CHARS = 6000;

export async function embedText(text: string): Promise<number[]> {
  if (Date.now() < embedderDownUntil) throw new Error("Embedder unavailable (cooling down)");
  try {
    return await embedTextOnce(text);
  } catch (error) {
    embedderDownUntil = Date.now() + EMBEDDER_COOLDOWN_MS;
    throw error;
  }
}

async function embedTextOnce(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, MAX_PROMPT_CHARS) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

// The embedder (Ollama) is optional: when it is down or not configured (local dev, a failing VPS), calls fail
// fast for a minute instead of stalling every chat turn / upload, and callers fall back to keyword retrieval.
let embedderDownUntil = 0;
const EMBEDDER_COOLDOWN_MS = 60_000;

/** Embedding or null when the embedder is unavailable. Never throws. */
export async function tryEmbedText(text: string): Promise<number[] | null> {
  try {
    return await embedText(text);
  } catch {
    return null;
  }
}

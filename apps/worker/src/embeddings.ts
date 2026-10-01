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
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

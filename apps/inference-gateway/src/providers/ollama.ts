import type { GenerateRequest, GenerateResult, InferenceProvider } from "../types";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct-q4_K_M";

export class OllamaProvider implements InferenceProvider {
  readonly name = "self_hosted" as const;

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const start = Date.now();
    const prompt = `${req.systemPrompt}\n\n${req.prompt}`;

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
    const data = (await res.json()) as {
      response: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: data.response,
      provider: "self_hosted",
      model: OLLAMA_MODEL,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}

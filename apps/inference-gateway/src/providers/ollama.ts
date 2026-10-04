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
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: req.temperature ?? 0.2 } }),
      signal: AbortSignal.timeout(60000),
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

  async *generateStream(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<string, GenerateResult, void> {
    const start = Date.now();
    const prompt = `${req.systemPrompt}\n\n${req.prompt}`;

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: true, options: { temperature: req.temperature ?? 0.2 } }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Ollama request failed: ${res.status}`);

    let fullText = "";
    let promptEvalCount = 0;
    let evalCount = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as { response?: string; done?: boolean; prompt_eval_count?: number; eval_count?: number };
        if (chunk.response) {
          fullText += chunk.response;
          yield chunk.response;
        }
        if (chunk.done) {
          promptEvalCount = chunk.prompt_eval_count ?? 0;
          evalCount = chunk.eval_count ?? 0;
        }
      }
    }

    return {
      text: fullText,
      provider: "self_hosted",
      model: OLLAMA_MODEL,
      inputTokens: promptEvalCount,
      outputTokens: evalCount,
      latencyMs: Date.now() - start,
    };
  }
}

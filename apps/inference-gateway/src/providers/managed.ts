import type { GenerateRequest, GenerateResult, InferenceProvider } from "../types";

const MANAGED_API_URL = process.env.MANAGED_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MANAGED_API_KEY = process.env.MANAGED_API_KEY;
const MANAGED_MODEL = process.env.MANAGED_MODEL ?? "qwen/qwen-2.5-7b-instruct";

export class ManagedProvider implements InferenceProvider {
  readonly name = "managed" as const;

  async isHealthy(): Promise<boolean> {
    return Boolean(MANAGED_API_KEY);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!MANAGED_API_KEY) throw new Error("MANAGED_API_KEY not configured");
    const start = Date.now();

    const res = await fetch(MANAGED_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MANAGED_API_KEY}`,
      },
      body: JSON.stringify({
        model: MANAGED_MODEL,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.prompt },
        ],
        max_tokens: req.maxTokens ?? 512,
        // Enforce zero data retention on every request — no training/storage of business data by any
        // upstream provider. Both fields live under `provider` per OpenRouter's documented API (confirmed
        // via https://openrouter.ai/docs/features/provider-routing) — a bare top-level `zdr` is a no-op.
        provider: { zdr: true, data_collection: "deny" },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`Managed provider request failed: ${res.status}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      error?: { message?: string };
    };
    // ZDR/data_collection routing restrictions surface as an error (no eligible provider) rather than
    // being silently ignored — catch that explicitly instead of returning a non-compliant answer.
    if (data.error) throw new Error(`Managed provider rejected request: ${data.error.message ?? "unknown error"}`);

    return {
      text: data.choices[0]?.message.content ?? "",
      provider: "managed",
      model: MANAGED_MODEL,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}

import type { GenerateRequest, GenerateResult, InferenceProvider } from "../types";

const MANAGED_API_URL = process.env.MANAGED_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MANAGED_API_KEY = process.env.MANAGED_API_KEY;
const MANAGED_MODEL = process.env.MANAGED_MODEL ?? "qwen/qwen-2.5-7b-instruct";
// Tried qwen-2.5-72b-instruct here for listing_extraction's images-array problem — reverted.
// Confirmed via direct, isolated test calls: qwen-2.5-72b-instruct + the required
// `provider: { zdr: true, data_collection: "deny" }` routing (see generate() below — this is a
// deliberate compliance requirement, not something to relax to fix this) together leave almost no
// eligible fast provider for this specific model; body streaming took 60s+ and never completed,
// vs 7B+ZDR responding in ~300ms and 72B WITHOUT zdr responding in ~1s. The slowness is specific
// to the ZDR+72B combination, not the prompt or the model's general capability. Defaults back to
// the same model as everything else until a bigger model with real ZDR-compliant capacity is
// identified — override via env if testing a different candidate.
const MANAGED_MODEL_LISTING_EXTRACTION = process.env.MANAGED_MODEL_LISTING_EXTRACTION ?? MANAGED_MODEL;

function modelForPurpose(purpose: GenerateRequest["purpose"]): string {
  return purpose === "listing_extraction" ? MANAGED_MODEL_LISTING_EXTRACTION : MANAGED_MODEL;
}

// Simple in-memory circuit breaker: when the provider returns a definitive, non-retryable
// failure (e.g. 402 payment required), remember when and skip straight to the fallback for a
// cooldown window instead of repeating the same doomed call on every request. Single-process
// gateway, so a module-level variable is fine — no need for Redis/shared state.
const CIRCUIT_BREAKER_COOLDOWN_MS = 15000;
// 402 (payment required) is deliberately NOT in this set — credit can be topped up at any
// moment, so a past 402 shouldn't keep punishing requests with a blanket breaker; it's retried
// on the next request instead.
const NON_RETRYABLE_STATUS_CODES = new Set([401, 403]);
let lastDefinitiveFailureAt: number | null = null;

export class ManagedProvider implements InferenceProvider {
  readonly name = "managed" as const;

  async isHealthy(): Promise<boolean> {
    if (!MANAGED_API_KEY) return false;
    if (lastDefinitiveFailureAt && Date.now() - lastDefinitiveFailureAt < CIRCUIT_BREAKER_COOLDOWN_MS) {
      return false;
    }
    return true;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!MANAGED_API_KEY) throw new Error("MANAGED_API_KEY not configured");
    const start = Date.now();
    const model = modelForPurpose(req.purpose);

    const res = await fetch(MANAGED_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MANAGED_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.prompt },
        ],
        max_tokens: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0.2,
        // Enforce zero data retention on every request — no training/storage of business data by any
        // upstream provider. Both fields live under `provider` per OpenRouter's documented API (confirmed
        // via https://openrouter.ai/docs/features/provider-routing) — a bare top-level `zdr` is a no-op.
        provider: { zdr: true, data_collection: "deny" },
      }),
      // 72B listing_extraction calls need materially more time than the 7B chat-path default —
      // confirmed live: 20s timed out on the very first real run after switching models. 45s
      // covers the slower model's real latency while staying well inside the 60s per-window
      // ceiling listing-extraction.service.ts is tuned around.
      signal: AbortSignal.timeout(req.purpose === "listing_extraction" ? 45000 : 20000),
    });

    if (!res.ok) {
      if (NON_RETRYABLE_STATUS_CODES.has(res.status)) {
        lastDefinitiveFailureAt = Date.now();
      }
      throw new Error(`Managed provider request failed: ${res.status}`);
    }
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
      model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}

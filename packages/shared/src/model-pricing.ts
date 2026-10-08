// Approximate USD-per-million-token rates by provider+model, for cost ESTIMATES only — not reconciled billing.
// Add a new model's pricing here (one line); unknown combos are treated as $0/unknown, never guessed.
// Source for z-ai/glm-4.7-flash: OpenRouter live models API (https://openrouter.ai/api/v1/models),
// pricing.prompt=0.0000000605 USD/token, pricing.completion=0.0000004 USD/token (verified 2026-10-07),
// converted to this table's per-million-token convention: x * 1_000_000.
const PRICING_TABLE: Record<string, Record<string, { inputPerMillion: number; outputPerMillion: number }>> = {
  managed: {
    "qwen/qwen-2.5-7b-instruct": { inputPerMillion: 0.1, outputPerMillion: 0.2 },
    "z-ai/glm-4.7-flash": { inputPerMillion: 0.0605, outputPerMillion: 0.4 },
  },
  self_hosted: {
    "qwen2.5:7b-instruct-q4_K_M": { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

export function estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING_TABLE[provider]?.[model];
  if (!rate) {
    console.warn(`[model-pricing] no pricing entry for provider="${provider}" model="${model}"; cost estimate will be $0`);
    return 0;
  }
  return (inputTokens * rate.inputPerMillion + outputTokens * rate.outputPerMillion) / 1_000_000;
}

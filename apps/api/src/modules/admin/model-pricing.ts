// Approximate USD-per-million-token rates by provider+model, for cost ESTIMATES only — not reconciled billing.
// Add a new model's pricing here (one line); unknown combos are treated as $0/unknown, never guessed.
const PRICING_TABLE: Record<string, Record<string, { inputPerMillion: number; outputPerMillion: number }>> = {
  managed: {
    "qwen/qwen-2.5-7b-instruct": { inputPerMillion: 0.1, outputPerMillion: 0.2 },
  },
  self_hosted: {
    "qwen2.5:7b-instruct-q4_K_M": { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

export function estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING_TABLE[provider]?.[model];
  if (!rate) return 0;
  return (inputTokens * rate.inputPerMillion + outputTokens * rate.outputPerMillion) / 1_000_000;
}

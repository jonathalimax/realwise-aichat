export type InferencePurpose = "chat" | "chips" | "summary" | "extraction" | "eval" | "rerank";

export interface GenerateRequest {
  purpose: InferencePurpose;
  businessId?: string;
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  // Lower temperature for grounded/RAG calls where faithfulness to the retrieved chunks matters
  // more than creative phrasing — undefined lets each provider fall back to its own default.
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  provider: "self_hosted" | "managed";
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface InferenceProvider {
  name: "self_hosted" | "managed";
  isHealthy(): Promise<boolean>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

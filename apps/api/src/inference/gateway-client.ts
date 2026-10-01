const GATEWAY_URL = process.env.INFERENCE_GATEWAY_URL ?? "http://localhost:3002";
const GATEWAY_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

export interface GatewayGenerateParams {
  purpose: "chat" | "chips" | "summary" | "extraction" | "eval" | "rerank";
  businessId: string;
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
}

export interface GatewayGenerateResult {
  text: string;
  provider: "self_hosted" | "managed";
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function generateFromGateway(params: GatewayGenerateParams): Promise<GatewayGenerateResult> {
  const res = await fetch(`${GATEWAY_URL}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_TOKEN ? { "x-internal-token": GATEWAY_TOKEN } : {}),
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Inference gateway error ${res.status}: ${body}`);
  }
  return res.json();
}

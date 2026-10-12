const GATEWAY_URL = process.env.INFERENCE_GATEWAY_URL ?? "http://localhost:3002";
const GATEWAY_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

export interface GatewayGenerateParams {
  purpose: "chat" | "chips" | "summary" | "extraction" | "listing_extraction" | "eval" | "rerank";
  businessId: string;
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  // Lower temperature for grounded/RAG calls where faithfulness to the retrieved chunks matters
  // more than creative phrasing — sent in the request body, unlike timeoutMs below.
  temperature?: number;
  // Client-side AbortSignal timeout only — never sent in the request body.
  timeoutMs?: number;
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
  const { timeoutMs, ...body } = params;
  const res = await fetch(`${GATEWAY_URL}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_TOKEN ? { "x-internal-token": GATEWAY_TOKEN } : {}),
    },
    body: JSON.stringify(body),
    // Must stay longer than ollama.ts's own 60000ms internal timeout, otherwise this outer
    // timeout always wins the race and the inner one never actually fires.
    signal: AbortSignal.timeout(timeoutMs ?? 65000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Inference gateway error ${res.status}: ${body}`);
  }
  return res.json();
}

// Parses the gateway's SSE stream (event: delta|done|error) and calls onDelta as text arrives.
// Resolves with the full accumulated text + final metadata once the "done" event lands.
export async function generateFromGatewayStream(
  params: GatewayGenerateParams,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<GatewayGenerateResult> {
  const res = await fetch(`${GATEWAY_URL}/generate/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_TOKEN ? { "x-internal-token": GATEWAY_TOKEN } : {}),
    },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Inference gateway stream error ${res.status}: ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finalResult: GatewayGenerateResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const eventMatch = raw.match(/^event: (\w+)/m);
      const dataMatch = raw.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;
      const payload = JSON.parse(dataMatch[1]);
      if (eventMatch[1] === "delta") {
        fullText += payload.text;
        onDelta(payload.text);
      } else if (eventMatch[1] === "done") {
        finalResult = payload;
      } else if (eventMatch[1] === "error") {
        throw new Error(payload.message ?? "inference_stream_failed");
      }
    }
  }

  return finalResult ?? { text: fullText, provider: "self_hosted", model: "unknown", inputTokens: 0, outputTokens: 0, latencyMs: 0 };
}

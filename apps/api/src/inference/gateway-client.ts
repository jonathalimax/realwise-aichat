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

// Carries the HTTP status (when there was one) so callers can tell a retryable failure (timeout,
// network, 429, 5xx, empty/malformed body) from a definitive one (other 4xx, e.g. 402 budget).
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function generateFromGateway(
  params: GatewayGenerateParams,
  externalSignal?: AbortSignal,
): Promise<GatewayGenerateResult> {
  const { timeoutMs, ...body } = params;
  // Must stay longer than ollama.ts's own 60000ms internal timeout, otherwise this outer
  // timeout always wins the race and the inner one never actually fires.
  const timeoutSignal = AbortSignal.timeout(timeoutMs ?? 65000);
  const signal = externalSignal ? anySignal([timeoutSignal, externalSignal]) : timeoutSignal;
  const res = await fetch(`${GATEWAY_URL}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_TOKEN ? { "x-internal-token": GATEWAY_TOKEN } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new GatewayError(`Inference gateway error ${res.status}: ${text.slice(0, 300)}`, res.status, retryable, retryAfterMs(res.headers.get("retry-after")));
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new GatewayError("Inference gateway returned a malformed body", res.status, true);
  }
  if (!json || typeof (json as GatewayGenerateResult).text !== "string") {
    throw new GatewayError("Inference gateway response has no text", res.status, true);
  }
  return json as GatewayGenerateResult;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

// Visitor-facing generation: a per-attempt timeout, an overall deadline, and ONE bounded retry
// (exponential backoff + jitter, honoring Retry-After) on retryable failures only. An empty answer
// counts as a retryable failure — a blank reply must never reach the visitor. The gateway itself
// already falls back between providers (managed <-> self-hosted), so this layer only covers the
// API <-> gateway hop and transient upstream errors. Throws the last error once attempts or the
// deadline run out; callers turn that into a deterministic degraded reply.
//
// Defaults (overridable via env for ops/tests): 40s per attempt (just above the gateway's own 35s
// managed-chat timeout, so the gateway can surface its error / try its self-hosted fallback first)
// and 50s overall — the chat client keeps the SSE connection alive with heartbeats, and past that
// point a visitor is better served by the scripted fallback than by more waiting.
export async function generateResilient(
  params: Omit<GatewayGenerateParams, "timeoutMs">,
  signal?: AbortSignal,
): Promise<GatewayGenerateResult> {
  const attemptTimeoutMs = envMs("CHAT_LLM_TIMEOUT_MS", 40000);
  const deadline = Date.now() + envMs("CHAT_LLM_DEADLINE_MS", 50000);
  const baseBackoffMs = envMs("CHAT_LLM_RETRY_BASE_MS", 500);
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) break;
    try {
      const result = await generateFromGateway({ ...params, timeoutMs: Math.min(attemptTimeoutMs, remaining) }, signal);
      if (!result.text.trim()) throw new GatewayError("Inference gateway returned an empty answer", null, true);
      return result;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) break;
      const retryable = error instanceof GatewayError ? error.retryable : true; // timeouts/network errors
      if (!retryable || attempt === maxAttempts - 1) break;
      const backoff = baseBackoffMs * 2 ** attempt + Math.random() * baseBackoffMs;
      const minUsefulAttemptMs = Math.min(1000, attemptTimeoutMs / 2);
      // The upstream asked for a pause longer than we can afford: degrade now instead of
      // sleeping through the visitor's patience for a doomed last attempt.
      if (error instanceof GatewayError && error.retryAfterMs && error.retryAfterMs > deadline - Date.now() - minUsefulAttemptMs) break;
      const wait = Math.min(Math.max(backoff, error instanceof GatewayError && error.retryAfterMs ? error.retryAfterMs : 0), deadline - Date.now() - minUsefulAttemptMs);
      // Not enough time left for a useful second attempt: degrade now rather than make the visitor wait.
      if (wait < 0) break;
      await sleep(wait, signal);
    }
  }
  throw lastError ?? new GatewayError("Inference deadline exceeded", null, false);
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

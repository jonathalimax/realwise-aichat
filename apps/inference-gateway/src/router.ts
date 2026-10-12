import { prisma } from "@realwise/db";
import { estimateCostUsd } from "@realwise/shared";
import { OllamaProvider } from "./providers/ollama";
import { ManagedProvider } from "./providers/managed";
import { recordSpend } from "./budget";
import type { GenerateRequest, GenerateResult } from "./types";

const selfHosted = new OllamaProvider();
const managed = new ManagedProvider();

export async function routeGenerate(req: GenerateRequest): Promise<GenerateResult> {
  let result: GenerateResult;
  let error: string | undefined;

  // When MANAGED_API_KEY is configured, prefer it over self-hosted Ollama: Ollama stays "healthy" (reachable)
  // even when queued/slow under concurrency, so health alone can't detect capacity problems.
  const managedConfigured = await managed.isHealthy();

  try {
    if (managedConfigured) {
      result = await managed.generate(req);
    } else if (await selfHosted.isHealthy()) {
      result = await selfHosted.generate(req);
    } else {
      result = await managed.generate(req);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    // Only actually attempt the self-hosted fallback when it's genuinely capable of serving this
    // request (server up AND the right model pulled) — otherwise it's a guaranteed second failure
    // that masks the real (often transient/retryable) managed-provider error behind an unrelated
    // Ollama error. Surface the original error directly instead.
    const fallbackViable = managedConfigured ? await selfHosted.isHealthy() : true;
    if (!fallbackViable) {
      await logCall(req, null, error);
      throw e;
    }
    try {
      result = managedConfigured ? await selfHosted.generate(req) : await managed.generate(req);
    } catch (fallbackError) {
      await logCall(req, null, `${error} | fallback failed: ${fallbackError}`);
      throw fallbackError;
    }
  }

  await logCall(req, result);
  return result;
}

export async function logCall(req: GenerateRequest, result: GenerateResult | null, error?: string) {
  const usdCents = result
    ? estimateCostUsd(result.provider, result.model, result.inputTokens, result.outputTokens) * 100
    : 0;

  await prisma.llmCallLog.create({
    data: {
      businessId: req.businessId,
      purpose: req.purpose,
      model: result?.model ?? "unknown",
      provider: result?.provider ?? "self_hosted",
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      latencyMs: result?.latencyMs ?? 0,
      costEstimateMicroCents: Math.round(usdCents * 1_000_000),
      error,
    },
  });

  if (req.businessId && result) {
    recordSpend(req.businessId, usdCents);
  }
}

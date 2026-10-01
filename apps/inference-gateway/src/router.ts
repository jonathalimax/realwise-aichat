import { prisma } from "@realwise/db";
import { OllamaProvider } from "./providers/ollama";
import { ManagedProvider } from "./providers/managed";
import type { GenerateRequest, GenerateResult } from "./types";

const selfHosted = new OllamaProvider();
const managed = new ManagedProvider();

export async function routeGenerate(req: GenerateRequest): Promise<GenerateResult> {
  let result: GenerateResult;
  let error: string | undefined;

  try {
    if (await selfHosted.isHealthy()) {
      result = await selfHosted.generate(req);
    } else {
      result = await managed.generate(req);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    try {
      result = await managed.generate(req);
    } catch (fallbackError) {
      await logCall(req, null, `${error} | fallback failed: ${fallbackError}`);
      throw fallbackError;
    }
  }

  await logCall(req, result);
  return result;
}

export async function logCall(req: GenerateRequest, result: GenerateResult | null, error?: string) {
  await prisma.llmCallLog.create({
    data: {
      businessId: req.businessId,
      purpose: req.purpose,
      model: result?.model ?? "unknown",
      provider: result?.provider ?? "self_hosted",
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      latencyMs: result?.latencyMs ?? 0,
      error,
    },
  });
}

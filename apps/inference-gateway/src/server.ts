import Fastify from "fastify";
import { timingSafeEqual } from "crypto";
import { routeGenerate, logCall } from "./router";
import { OllamaProvider } from "./providers/ollama";
import { ManagedProvider } from "./providers/managed";
import type { GenerateRequest } from "./types";

const selfHosted = new OllamaProvider();
const managed = new ManagedProvider();

const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;
if (!INTERNAL_TOKEN || INTERNAL_TOKEN.length < 16) {
  throw new Error("INFERENCE_GATEWAY_TOKEN must be set to a strong value (>=16 chars) before starting this service");
}

const app = Fastify({ logger: true });

function safeTokenMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!safeTokenMatch(request.headers["x-internal-token"], INTERNAL_TOKEN)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.post<{ Body: GenerateRequest }>("/generate", async (request, reply) => {
  try {
    const result = await routeGenerate(request.body);
    return result;
  } catch (error) {
    reply.code(502);
    return { error: error instanceof Error ? error.message : "inference_failed" };
  }
});

app.post<{ Body: GenerateRequest }>("/generate/stream", async (request, reply) => {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) controller.abort();
  });

  try {
    // Same priority as routeGenerate() in router.ts: when MANAGED_API_KEY is configured, prefer it
    // over self-hosted Ollama even if Ollama is reachable — Ollama stays "healthy" while queued/slow
    // under concurrency, so health alone can't detect capacity problems. This route previously
    // checked selfHosted.isHealthy() first unconditionally, meaning every streamed reply (all
    // free-text chat) silently went to the slow self-hosted path regardless of this fix already
    // being applied to the non-streaming /generate route — the actual cause of streamed replies
    // routinely taking 60s+ or appearing to hang entirely.
    const managedConfigured = await managed.isHealthy();
    if (!managedConfigured && (await selfHosted.isHealthy())) {
      const gen = selfHosted.generateStream(request.body, controller.signal);
      let next = await gen.next();
      while (!next.done) {
        send("delta", { text: next.value });
        next = await gen.next();
      }
      const result = next.value;
      await logCall(request.body, result);
      send("done", result);
    } else {
      // ManagedProvider has no token-level streaming — send the full text as one delta so the
      // frontend still gets a "done" with real usage/latency instead of a fake incremental stream.
      let result;
      try {
        result = await managed.generate(request.body);
      } catch (managedError) {
        // Mirror routeGenerate()'s fallback in router.ts — a managed-provider failure (rate limit,
        // transient outage, momentary credit dip) must not take down every streamed chat reply when
        // self-hosted Ollama is available as a backstop.
        if (await selfHosted.isHealthy()) {
          const gen = selfHosted.generateStream(request.body, controller.signal);
          let next = await gen.next();
          while (!next.done) {
            send("delta", { text: next.value });
            next = await gen.next();
          }
          result = next.value;
          await logCall(request.body, result, `managed failed: ${managedError instanceof Error ? managedError.message : String(managedError)}`);
          send("done", result);
          reply.raw.end();
          return;
        }
        throw managedError;
      }
      send("delta", { text: result.text });
      await logCall(request.body, result);
      send("done", result);
    }
  } catch (error) {
    send("error", { message: error instanceof Error ? error.message : "inference_failed" });
  }
  reply.raw.end();
});

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3002);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`Realwise inference-gateway listening on :${port}`);
});

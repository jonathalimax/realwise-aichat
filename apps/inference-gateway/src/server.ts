import Fastify from "fastify";
import { timingSafeEqual } from "crypto";
import { routeGenerate } from "./router";
import type { GenerateRequest } from "./types";

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

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3002);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`RealWise inference-gateway listening on :${port}`);
});

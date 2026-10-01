import Fastify from "fastify";
import { routeGenerate } from "./router";
import type { GenerateRequest } from "./types";

const app = Fastify({ logger: true });

const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

app.addHook("onRequest", async (request, reply) => {
  if (!INTERNAL_TOKEN) return;
  if (request.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    reply.code(401).send({ error: "unauthorized" });
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

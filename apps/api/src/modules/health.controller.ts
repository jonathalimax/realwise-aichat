import { Controller, Get } from "@nestjs/common";
import Redis from "ioredis";
import pg from "pg";

@Controller("health")
export class HealthController {
  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    const dependencies = await checkDependencies();
    const ok = Object.values(dependencies).every((status) => status === "ok" || status === "not_configured");
    return { status: ok ? "ok" : "degraded", dependencies };
  }

  @Get("dependencies")
  async dependencies() {
    const dependencies = await checkDependencies();
    const ok = Object.values(dependencies).every((status) => status === "ok" || status === "not_configured");
    return {
      status: ok ? "ok" : "degraded",
      dependencies: {
        ...dependencies,
        meta: process.env.META_APP_ID ? "configured" : "mock",
        stripe: process.env.STRIPE_SECRET_KEY ? "configured" : "not_configured",
        chatwoot: process.env.CHATWOOT_PLATFORM_TOKEN ? "configured" : "not_configured",
      },
    };
  }
}

async function checkDependencies() {
  const [database, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  return { database, redis };
}

async function checkPostgres(): Promise<"ok" | "not_configured" | "error"> {
  if (!process.env.DATABASE_URL) return "not_configured";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 1_000 });
  try {
    await pool.query("select 1");
    return "ok";
  } catch {
    return "error";
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkRedis(): Promise<"ok" | "not_configured" | "error"> {
  if (!process.env.REDIS_URL) return "not_configured";
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1_000 });
  try {
    await redis.connect();
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    redis.disconnect();
  }
}

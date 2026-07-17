import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return { status: "ok", dependencies: { api: "ok" } };
  }

  @Get("dependencies")
  dependencies() {
    return {
      status: "degraded",
      dependencies: {
        database: process.env.DATABASE_URL ? "configured" : "missing",
        redis: process.env.REDIS_URL ? "configured" : "missing",
        meta: process.env.META_APP_ID ? "configured" : "mock",
        stripe: process.env.STRIPE_SECRET_KEY ? "configured" : "not_configured",
        chatwoot: process.env.CHATWOOT_PLATFORM_TOKEN ? "configured" : "not_configured",
      },
    };
  }
}

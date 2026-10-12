import { Controller, Get } from "@nestjs/common";

// Dedicated liveness endpoint for uptime monitoring (Uptime Kuma etc.) -- deliberately has no
// dependencies (no DB call) so it reflects "is the process up and routing requests", the same
// signal the docker-compose healthcheck already uses, without adding a DB round-trip to every
// monitor ping.
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

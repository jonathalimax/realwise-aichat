import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { auditEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import { SessionTenantGuard } from "./session-tenant.guard";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

@Controller("audit")
@UseGuards(SessionTenantGuard)
export class AuditController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  @Get("events")
  async events(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.optional();
    if (!db) return [];
    return db.select().from(auditEvents).where(eq(auditEvents.tenantId, context.tenantId)).orderBy(desc(auditEvents.createdAt)).limit(50);
  }
}

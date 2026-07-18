import { Inject, Injectable } from "@nestjs/common";
import { auditEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  async record(input: { tenantId?: string | null; actorUserId?: string | null; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }) {
    const db = this.databaseProvider.optional();
    if (!db) return;
    await db.insert(auditEvents).values({
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });
  }
}

import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { channelConnections } from "@realwise/database";
import { providerSchema } from "@realwise/contracts";
import { AuditService } from "./audit.service";
import { DatabaseProvider } from "./database.provider";
import { SessionTenantGuard } from "./session-tenant.guard";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

const connectMockSchema = z.object({
  provider: providerSchema,
  externalAssetId: z.string().min(1).optional(),
});

@Controller("channels")
@UseGuards(SessionTenantGuard)
export class ChannelsController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider, @Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  async list(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.optional();
    if (!db) {
      return [
        { provider: "WHATSAPP", status: "CONNECTED", releaseState: "MOCK_VERIFIED" },
        { provider: "INSTAGRAM", status: "CONNECTED", releaseState: "MOCK_VERIFIED" },
        { provider: "FACEBOOK", status: "ACTION_REQUIRED", releaseState: "MOCK_VERIFIED" },
      ];
    }
    return db.select().from(channelConnections).where(eq(channelConnections.tenantId, context.tenantId));
  }

  @Post("connect-mock")
  async connectMock(@TenantContext() context: RequestTenantContext, @Body() body: unknown) {
    const input = connectMockSchema.parse(body);
    const db = this.databaseProvider.require();
    const [existing] = await db.select().from(channelConnections).where(and(eq(channelConnections.tenantId, context.tenantId), eq(channelConnections.provider, input.provider))).limit(1);
    if (existing) {
      const [connection] = await db.update(channelConnections).set({
        status: "CONNECTED",
        externalAssetId: input.externalAssetId ?? `mock-${input.provider.toLowerCase()}`,
        releaseState: "MOCK_VERIFIED",
        updatedAt: new Date(),
      }).where(eq(channelConnections.id, existing.id)).returning();
      await this.auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, action: "CHANNEL_MOCK_CONNECTED", targetType: "channel_connection", targetId: connection?.id, metadata: { provider: input.provider } });
      return connection;
    }
    const [connection] = await db.insert(channelConnections).values({
      tenantId: context.tenantId,
      provider: input.provider,
      status: "CONNECTED",
      externalAssetId: input.externalAssetId ?? `mock-${input.provider.toLowerCase()}`,
      releaseState: "MOCK_VERIFIED",
    }).returning();
    await this.auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, action: "CHANNEL_MOCK_CONNECTED", targetType: "channel_connection", targetId: connection?.id, metadata: { provider: input.provider } });
    return connection;
  }
}

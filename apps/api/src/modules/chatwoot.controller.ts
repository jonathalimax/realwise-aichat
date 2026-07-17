import { Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { buildMockChatwootInstallation, chatwootActivationState } from "@realwise/chatwoot";
import { chatwootInstallations } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import { SessionTenantGuard } from "./session-tenant.guard";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

@Controller("chatwoot")
@UseGuards(SessionTenantGuard)
export class ChatwootController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  @Get("status")
  async status(@TenantContext() context: RequestTenantContext) {
    const activation = chatwootActivationState({ baseUrl: process.env.CHATWOOT_BASE_URL, platformToken: process.env.CHATWOOT_PLATFORM_TOKEN });
    const db = this.databaseProvider.optional();
    if (!db) {
      return { activation, installation: buildMockChatwootInstallation(context.tenantId), releaseState: "MOCK_VERIFIED" };
    }
    const [installation] = await db.select().from(chatwootInstallations).where(eq(chatwootInstallations.tenantId, context.tenantId)).limit(1);
    return { activation, installation: installation ?? null, releaseState: installation?.releaseState ?? "IMPLEMENTED_NOT_VERIFIED" };
  }

  @Post("provision-mock")
  async provisionMock(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.require();
    const mock = buildMockChatwootInstallation(context.tenantId);
    const [installation] = await db.insert(chatwootInstallations).values({
      tenantId: context.tenantId,
      accountId: mock.accountId,
      inboxId: mock.inboxId,
      status: mock.status,
      releaseState: "MOCK_VERIFIED",
    }).onConflictDoUpdate({
      target: chatwootInstallations.tenantId,
      set: {
        accountId: mock.accountId,
        inboxId: mock.inboxId,
        status: mock.status,
        releaseState: "MOCK_VERIFIED",
        updatedAt: new Date(),
      },
    }).returning();
    return installation;
  }
}

import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { DashboardSummary } from "@realwise/contracts";
import { and, eq, sql } from "drizzle-orm";
import { channelConnections, knowledgeSources, leads, tenants, usageEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import { TenantContext, type RequestTenantContext } from "./tenant-context";
import { SessionTenantGuard } from "./session-tenant.guard";

@Controller("dashboard")
@UseGuards(SessionTenantGuard)
export class DashboardController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  @Get("summary")
  async summary(@TenantContext() context: RequestTenantContext): Promise<DashboardSummary> {
    const db = this.databaseProvider.optional();
    if (!db) return demoSummary;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
    const [channelCount] = await db.select({ count: sql<number>`count(*)::int` }).from(channelConnections).where(eq(channelConnections.tenantId, context.tenantId));
    const [actionCount] = await db.select({ count: sql<number>`count(*)::int` }).from(channelConnections).where(and(eq(channelConnections.tenantId, context.tenantId), eq(channelConnections.status, "ACTION_REQUIRED")));
    const [knowledgeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(knowledgeSources).where(eq(knowledgeSources.tenantId, context.tenantId));
    const [leadCount] = await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.tenantId, context.tenantId));
    const [messageUsage] = await db.select({ total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` }).from(usageEvents).where(eq(usageEvents.tenantId, context.tenantId));

    return {
      tenant: {
        id: tenant?.id ?? context.tenantId,
        name: tenant?.name ?? "Tenant não encontrado",
        segment: tenant?.segment ?? "Negócio local",
        aiEnabled: tenant?.aiEnabled ?? false,
        releaseState: tenant?.releaseState ?? "IMPLEMENTED_NOT_VERIFIED",
      },
      health: {
        channelsConnected: channelCount?.count ?? 0,
        channelsWithActionRequired: actionCount?.count ?? 0,
        humansWaiting: leadCount?.count ?? 0,
        aiPausedConversations: 0,
      },
      usage: {
        messagesUsed: messageUsage?.total ?? 0,
        messagesLimit: 1000,
        knowledgeSources: knowledgeCount?.count ?? 0,
      },
      nextActions: ["Conectar canais reais.", "Cadastrar conhecimento aprovado.", "Revisar leads pendentes."],
    };
  }
}

const demoSummary: DashboardSummary = {
  tenant: {
    id: "demo-academia",
    name: "Academia Realwise Demo",
    segment: "Academia e artes marciais",
    aiEnabled: true,
    releaseState: "MOCK_VERIFIED",
  },
  health: {
    channelsConnected: 3,
    channelsWithActionRequired: 1,
    humansWaiting: 2,
    aiPausedConversations: 1,
  },
  usage: {
    messagesUsed: 384,
    messagesLimit: 1000,
    knowledgeSources: 7,
  },
  nextActions: [
    "Conectar credenciais reais da Meta para sair do modo mock.",
    "Revisar preços e horários aprovados da academia.",
    "Responder 2 conversas aguardando humano no Chatwoot.",
  ],
};

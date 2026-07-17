import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { plans, subscriptions, usageEvents } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import { SessionTenantGuard } from "./session-tenant.guard";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

@Controller("billing")
@UseGuards(SessionTenantGuard)
export class BillingController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider) {}

  @Get("entitlements")
  async entitlements(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.optional();
    if (!db) {
      return {
        plan: "pilot",
        status: process.env.STRIPE_SECRET_KEY ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED",
        limits: { messagesPerMonth: 1000, knowledgeSources: 25, teamMembers: 5 },
        usage: { messages: 0 },
      };
    }

    const [subscription] = await db
      .select({
        status: subscriptions.status,
        code: plans.code,
        name: plans.name,
        messagesPerMonth: plans.messagesPerMonth,
        knowledgeSourcesLimit: plans.knowledgeSourcesLimit,
        teamMembersLimit: plans.teamMembersLimit,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.tenantId, context.tenantId))
      .limit(1);

    const [messageUsage] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` })
      .from(usageEvents)
      .where(eq(usageEvents.tenantId, context.tenantId));

    return {
      plan: subscription?.code ?? "none",
      name: subscription?.name ?? "Sem plano",
      status: subscription?.status ?? "INACTIVE",
      activation: process.env.STRIPE_SECRET_KEY ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED",
      limits: {
        messagesPerMonth: subscription?.messagesPerMonth ?? 0,
        knowledgeSources: subscription?.knowledgeSourcesLimit ?? 0,
        teamMembers: subscription?.teamMembersLimit ?? 0,
      },
      usage: { messages: messageUsage?.total ?? 0 },
    };
  }
}

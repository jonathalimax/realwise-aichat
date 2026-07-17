import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { HealthController } from "./health.controller";
import { KnowledgeController } from "./knowledge.controller";
import { LeadsController } from "./leads.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { BillingController } from "./billing.controller";
import { ChannelsController } from "./channels.controller";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { DatabaseProvider } from "./database.provider";
import { SessionTenantGuard } from "./session-tenant.guard";
import { MessagingService } from "./messaging.service";

@Module({
  controllers: [AuthController, HealthController, DashboardController, ChannelsController, KnowledgeController, LeadsController, MetaWebhookController, BillingController],
  providers: [AuthService, DatabaseProvider, SessionTenantGuard, MessagingService],
})
export class AppModule {}

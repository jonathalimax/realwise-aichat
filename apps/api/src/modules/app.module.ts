import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { HealthController } from "./health.controller";
import { KnowledgeController } from "./knowledge.controller";
import { LeadsController } from "./leads.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { BillingController } from "./billing.controller";

@Module({
  controllers: [HealthController, DashboardController, KnowledgeController, LeadsController, MetaWebhookController, BillingController],
})
export class AppModule {}

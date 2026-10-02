import { Module } from "@nestjs/common";
import { OwnerAssistantController } from "./owner-assistant.controller";
import { OwnerAssistantService } from "./owner-assistant.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [AnalyticsModule, LeadsModule],
  controllers: [OwnerAssistantController],
  providers: [OwnerAssistantService],
})
export class OwnerAssistantModule {}

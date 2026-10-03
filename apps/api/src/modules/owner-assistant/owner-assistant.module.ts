import { Module } from "@nestjs/common";
import { OwnerAssistantController } from "./owner-assistant.controller";
import { OwnerAssistantService } from "./owner-assistant.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { LeadsModule } from "../leads/leads.module";
import { BusinessesModule } from "../businesses/businesses.module";

@Module({
  imports: [AnalyticsModule, LeadsModule, BusinessesModule],
  controllers: [OwnerAssistantController],
  providers: [OwnerAssistantService],
})
export class OwnerAssistantModule {}

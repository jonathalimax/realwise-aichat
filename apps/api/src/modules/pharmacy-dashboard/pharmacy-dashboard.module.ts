import { Module } from "@nestjs/common";
import { HandoffsModule } from "../handoffs/handoffs.module";
import { PharmacySettingsModule } from "../pharmacy-settings/pharmacy-settings.module";
import { DashboardSummaryController, NotificationsController, PharmacyAnalyticsController } from "./pharmacy-dashboard.controller";
import { PharmacyDashboardService } from "./pharmacy-dashboard.service";

@Module({
  imports: [HandoffsModule, PharmacySettingsModule],
  controllers: [DashboardSummaryController, PharmacyAnalyticsController, NotificationsController],
  providers: [PharmacyDashboardService],
})
export class PharmacyDashboardModule {}

import { Controller, Get, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  summary(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.dashboardSummary(session.businessId);
  }

  @Get("top-questions")
  topQuestions(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.topQuestions(session.businessId);
  }
}

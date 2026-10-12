import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

const ALLOWED_DAYS = [7, 30, 90];

function parseDays(days?: string): number {
  const parsed = Number(days);
  return ALLOWED_DAYS.includes(parsed) ? parsed : 14;
}

@UseGuards(BusinessSessionGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  summary(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.dashboardSummary(session.businessId);
  }

  @Get("timeseries")
  async timeseries(@CurrentBusiness() session: BusinessSessionClaims, @Query("days") days?: string) {
    let requestedDays = parseDays(days);
    if (requestedDays === 90 && !(await this.analytics.canSeeFullAnalytics(session.businessId))) {
      requestedDays = 30;
    }
    return this.analytics.timeseries(session.businessId, requestedDays);
  }

  @Get("top-questions")
  topQuestions(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.topQuestions(session.businessId);
  }

  @Get("insights")
  insights(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.getInsights(session.businessId);
  }

  @Get("advanced")
  advanced(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.getAdvancedAnalytics(session.businessId);
  }
}

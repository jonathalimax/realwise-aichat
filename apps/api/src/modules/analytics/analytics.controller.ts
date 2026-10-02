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
  timeseries(@CurrentBusiness() session: BusinessSessionClaims, @Query("days") days?: string) {
    return this.analytics.timeseries(session.businessId, parseDays(days));
  }

  @Get("top-questions")
  topQuestions(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.analytics.topQuestions(session.businessId);
  }
}

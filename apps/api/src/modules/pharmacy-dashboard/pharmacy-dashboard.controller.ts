import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { computeLiveMarkers } from "./live-markers";
import { PrismaService } from "../../prisma/prisma.service";
import { PharmacyDashboardService } from "./pharmacy-dashboard.service";

@Controller("dashboard")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
export class DashboardSummaryController {
  constructor(private readonly dashboard: PharmacyDashboardService) {}

  @RequirePermission("inicio", "view")
  @Get("summary")
  summary(@CurrentMember() m: MemberContext, @Query("range") range?: string) {
    return this.dashboard.summary(m, range);
  }
}

@Controller("analytics/pharmacy")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
export class PharmacyAnalyticsController {
  constructor(private readonly dashboard: PharmacyDashboardService) {}

  @RequirePermission("analises", "view")
  @Get("overview")
  overview(@CurrentMember() m: MemberContext, @Query("range") range?: string) {
    return this.dashboard.overview(m, range);
  }
}

@Controller("notifications")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly dashboard: PharmacyDashboardService, private readonly prisma: PrismaService) {}

  /** Live-refresh change markers (hashes of ids/status/timestamps only), scoped by business and by the member's permissions. */
  @Get("live")
  live(@CurrentMember() m: MemberContext) {
    return computeLiveMarkers(this.prisma.client as any, m);
  }

  // Any authenticated member: counts are filtered by what the member may see.
  @Get("summary")
  summary(@CurrentMember() m: MemberContext) {
    return this.dashboard.notificationsSummary(m);
  }
}

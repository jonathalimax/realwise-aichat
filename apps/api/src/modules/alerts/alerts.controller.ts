import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AlertsService } from "./alerts.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("inicio", "view")
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.alerts.listActive(session.businessId);
  }

  @Post(":id/dismiss")
  dismiss(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.alerts.dismiss(session.businessId, id);
  }
}

import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AvailabilityService, AvailabilityRuleInput } from "./availability.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("agenda", "view")
@Controller("bookings/availability")
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  listRules(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.availability.listRules(session.businessId);
  }

  @RequirePermission("agenda", "edit")
  @Post()
  upsertRule(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: AvailabilityRuleInput & { id?: string }) {
    return this.availability.upsertRule(session.businessId, body);
  }

  @RequirePermission("agenda", "edit")
  @Delete(":id")
  deleteRule(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.availability.deleteRule(session.businessId, id);
  }
}

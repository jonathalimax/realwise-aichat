import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AvailabilityService, AvailabilityRuleInput } from "./availability.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("bookings/availability")
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  listRules(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.availability.listRules(session.businessId);
  }

  @Post()
  upsertRule(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: AvailabilityRuleInput & { id?: string }) {
    return this.availability.upsertRule(session.businessId, body);
  }

  @Delete(":id")
  deleteRule(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.availability.deleteRule(session.businessId, id);
  }
}

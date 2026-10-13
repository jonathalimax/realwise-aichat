import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("leads", "view")
@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.leads.listForBusiness(session.businessId);
  }

  @Get(":id")
  detail(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.leads.getDetail(session.businessId, id);
  }

  @RequirePermission("leads", "edit")
  @Patch(":id/outcome")
  outcome(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("outcome") outcome: "won" | "lost" | "no_response") {
    return this.leads.markOutcome(session.businessId, id, outcome);
  }

  @RequirePermission("leads", "edit")
  @Patch(":id/status")
  status(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("status") status: unknown) {
    return this.leads.updateStatus(session.businessId, id, status);
  }

  @RequirePermission("leads", "edit")
  @Patch(":id/notes")
  notes(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("notes") notes: unknown) {
    return this.leads.updateNotes(session.businessId, id, notes);
  }

  @Post(":id/whatsapp-link")
  whatsappLink(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("topic") topic: string) {
    return this.leads.buildWhatsappLink(session.businessId, id, topic);
  }
}

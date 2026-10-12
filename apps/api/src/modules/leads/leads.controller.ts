import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
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

  @Patch(":id/outcome")
  outcome(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("outcome") outcome: "won" | "lost" | "no_response") {
    return this.leads.markOutcome(session.businessId, id, outcome);
  }

  @Patch(":id/status")
  status(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("status") status: unknown) {
    return this.leads.updateStatus(session.businessId, id, status);
  }

  @Patch(":id/notes")
  notes(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("notes") notes: unknown) {
    return this.leads.updateNotes(session.businessId, id, notes);
  }

  @Post(":id/whatsapp-link")
  whatsappLink(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("topic") topic: string) {
    return this.leads.buildWhatsappLink(session.businessId, id, topic);
  }
}

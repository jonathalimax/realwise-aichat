import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ComplianceService } from "./compliance.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness, CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims, VisitorSessionClaims } from "@realwise/auth";

@Controller("compliance")
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @UseGuards(VisitorSessionGuard)
  @Post("consent")
  recordConsent(
    @CurrentVisitor() visitor: VisitorSessionClaims,
    @Body("phone") phone: string,
    @Body("purposes") purposes: string[],
    @Req() req: Request,
  ) {
    return this.compliance.recordConsent(
      visitor.businessId,
      visitor.leadId,
      phone,
      purposes,
      req.ip ?? "",
      req.headers["user-agent"] ?? "",
    );
  }

  @UseGuards(BusinessSessionGuard)
  @Get("dsar")
  listOpenRequests(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.compliance.listOpenRequests(session.businessId);
  }

  @UseGuards(BusinessSessionGuard)
  @Post("dsar/:id/fulfill")
  fulfillRequest(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("notes") notes: string) {
    return this.compliance.fulfillRequest(session.businessId, id, notes);
  }

  @UseGuards(BusinessSessionGuard)
  @Delete("leads/:id")
  deleteLeadData(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.compliance.deleteLeadData(session.businessId, id);
  }
}

import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards, Get } from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness, CurrentMember } from "../../common/decorators/current-business.decorator";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly accessLog: AccessLogService,
  ) {}

  @Get("plans")
  plans() {
    return this.billing.listPlans();
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("plano", "edit")
  @Post("checkout")
  async checkout(@CurrentBusiness() session: BusinessSessionClaims, @CurrentMember() member: MemberContext, @Body("planCode") planCode: string) {
    const result = await this.billing.createCheckoutSession(session.businessId, planCode);
    await this.accessLog.record({ businessId: session.businessId, actor: member, action: "billing.change", summary: "Iniciou a troca de plano" });
    return result;
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("plano", "edit")
  @Post("portal")
  async portal(@CurrentBusiness() session: BusinessSessionClaims, @CurrentMember() member: MemberContext) {
    const result = await this.billing.createPortalSession(session.businessId);
    await this.accessLog.record({ businessId: session.businessId, actor: member, action: "billing.change", summary: "Abriu o portal de cobrança" });
    return result;
  }

  @Post("webhook")
  async webhook(@Req() req: Request, @Headers("stripe-signature") signature: string) {
    let event;
    try {
      event = this.billing.constructWebhookEvent(req.body, signature);
    } catch (err) {
      // Invalid/missing signature is a bad request, not a server error — don't make Stripe retry it.
      throw new BadRequestException("Invalid Stripe webhook signature");
    }
    await this.billing.handleWebhookEvent(event);
    return { received: true };
  }
}

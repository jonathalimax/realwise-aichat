import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards, Get } from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  plans() {
    return this.billing.listPlans();
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("plano", "edit")
  @Post("checkout")
  checkout(@CurrentBusiness() session: BusinessSessionClaims, @Body("planCode") planCode: string) {
    return this.billing.createCheckoutSession(session.businessId, planCode);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("plano", "edit")
  @Post("portal")
  portal(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.billing.createPortalSession(session.businessId);
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

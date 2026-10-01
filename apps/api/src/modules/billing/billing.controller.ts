import { Body, Controller, Headers, Post, Req, UseGuards, Get } from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "./billing.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  plans() {
    return this.billing.listPlans();
  }

  @UseGuards(BusinessSessionGuard)
  @Post("checkout")
  checkout(@CurrentBusiness() session: BusinessSessionClaims, @Body("planCode") planCode: string) {
    return this.billing.createCheckoutSession(session.businessId, planCode);
  }

  @UseGuards(BusinessSessionGuard)
  @Post("portal")
  portal(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.billing.createPortalSession(session.businessId);
  }

  @Post("webhook")
  async webhook(@Req() req: Request, @Headers("stripe-signature") signature: string) {
    const event = this.billing.constructWebhookEvent(req.body, signature);
    await this.billing.handleWebhookEvent(event);
    return { received: true };
  }
}

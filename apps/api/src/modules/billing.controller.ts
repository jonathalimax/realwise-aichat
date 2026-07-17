import { Controller, Get } from "@nestjs/common";

@Controller("billing")
export class BillingController {
  @Get("entitlements")
  entitlements() {
    return {
      plan: "pilot",
      status: process.env.STRIPE_SECRET_KEY ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED",
      limits: {
        messagesPerMonth: 1000,
        knowledgeSources: 25,
        teamMembers: 5,
      },
    };
  }
}

import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get("profile")
  getProfile(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.onboarding.getProfile(session.businessId);
  }

  @Post("profile/field")
  patchField(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("fieldKey") fieldKey: string,
    @Body("value") value: unknown,
    @Body("source") source: "document" | "interview" | "manual",
  ) {
    return this.onboarding.patchProfileField(session.businessId, fieldKey, value, source);
  }

  @Post("profile/field/approve")
  approveField(@CurrentBusiness() session: BusinessSessionClaims, @Body("fieldKey") fieldKey: string) {
    return this.onboarding.approveField(session.businessId, fieldKey);
  }

  @Post("interview")
  interviewChat(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("history") history: { role: "owner" | "clara"; content: string }[],
  ) {
    return this.onboarding.interviewChat(session.businessId, history ?? []);
  }

  @Patch("custom-instructions")
  updateCustomInstructions(@CurrentBusiness() session: BusinessSessionClaims, @Body("customInstructions") customInstructions: string) {
    return this.onboarding.updateCustomInstructions(session.businessId, customInstructions ?? "");
  }

  @Post("confidence/recompute")
  recomputeConfidence(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.onboarding.recomputeConfidence(session.businessId);
  }
}

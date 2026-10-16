import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission(["configuracoes", "farmacia"], "view")
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get("profile")
  getProfile(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.onboarding.getProfile(session.businessId);
  }

  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("profile/field")
  patchField(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("fieldKey") fieldKey: string,
    @Body("value") value: unknown,
    @Body("source") source: "document" | "interview" | "manual",
  ) {
    return this.onboarding.patchProfileField(session.businessId, fieldKey, value, source);
  }

  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("profile/field/approve")
  approveField(@CurrentBusiness() session: BusinessSessionClaims, @Body("fieldKey") fieldKey: string) {
    return this.onboarding.approveField(session.businessId, fieldKey);
  }

  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("interview")
  interviewChat(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("history") history: { role: "owner" | "clara"; content: string }[],
  ) {
    return this.onboarding.interviewChat(session.businessId, history ?? []);
  }

  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Patch("custom-instructions")
  updateCustomInstructions(@CurrentBusiness() session: BusinessSessionClaims, @Body("customInstructions") customInstructions: string) {
    return this.onboarding.updateCustomInstructions(session.businessId, customInstructions ?? "");
  }

  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("confidence/recompute")
  recomputeConfidence(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.onboarding.recomputeConfidence(session.businessId);
  }
}

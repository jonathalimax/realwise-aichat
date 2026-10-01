import { Controller, Param, Post, UseGuards } from "@nestjs/common";
import { OnboardingService } from "../onboarding/onboarding.service";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";

@UseGuards(InternalTokenGuard)
@Controller("internal")
export class InternalController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post("businesses/:businessId/confidence/recompute")
  recomputeConfidence(@Param("businessId") businessId: string) {
    return this.onboarding.recomputeConfidence(businessId);
  }
}

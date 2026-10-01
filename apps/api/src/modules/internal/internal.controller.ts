import { Controller, Param, Post, UseGuards } from "@nestjs/common";
import { OnboardingService } from "../onboarding/onboarding.service";
import { ChatService } from "../chat/chat.service";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";

@UseGuards(InternalTokenGuard)
@Controller("internal")
export class InternalController {
  constructor(private readonly onboarding: OnboardingService, private readonly chat: ChatService) {}

  @Post("businesses/:businessId/confidence/recompute")
  recomputeConfidence(@Param("businessId") businessId: string) {
    return this.onboarding.recomputeConfidence(businessId);
  }

  @Post("businesses/:businessId/chips/regenerate")
  regenerateChips(@Param("businessId") businessId: string) {
    return this.chat.regenerateChips(businessId);
  }
}

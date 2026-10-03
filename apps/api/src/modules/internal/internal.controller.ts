import { Controller, Param, Post, UseGuards } from "@nestjs/common";
import { OnboardingService } from "../onboarding/onboarding.service";
import { FlowService } from "../chat/flow.service";
import { ListingExtractionService } from "../listings/listing-extraction.service";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";

@UseGuards(InternalTokenGuard)
@Controller("internal")
export class InternalController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly flow: FlowService,
    private readonly listingExtraction: ListingExtractionService,
  ) {}

  @Post("businesses/:businessId/confidence/recompute")
  recomputeConfidence(@Param("businessId") businessId: string) {
    return this.onboarding.recomputeConfidence(businessId);
  }

  @Post("businesses/:businessId/flow-options/regenerate")
  regenerateFlowOptions(@Param("businessId") businessId: string) {
    return this.flow.regenerateFlowOptions(businessId);
  }

  @Post("businesses/:businessId/listings/extract")
  extractListings(@Param("businessId") businessId: string) {
    return this.listingExtraction.extractForBusiness(businessId);
  }
}

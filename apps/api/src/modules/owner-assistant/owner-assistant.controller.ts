import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { OwnerAssistantService } from "./owner-assistant.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("owner-assistant")
export class OwnerAssistantController {
  constructor(private readonly ownerAssistant: OwnerAssistantService) {}

  @Post("ask")
  ask(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("message") message: string,
    @Body("history") history: { role: "owner" | "assistant"; content: string }[],
  ) {
    return this.ownerAssistant.ask(session.businessId, message, history ?? []);
  }
}

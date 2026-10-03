import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get("conversations")
  list(@CurrentBusiness() session: BusinessSessionClaims, @Query("filter") filter?: "all" | "escalated") {
    return this.inbox.listConversations(session.businessId, filter);
  }

  @Get("conversations/:id")
  thread(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.inbox.getThread(session.businessId, id);
  }

  @Post("conversations/:id/messages")
  sendMessage(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body("text") text: string) {
    return this.inbox.sendOwnerMessage(session.businessId, id, text);
  }

  @Post("conversations/:id/read")
  markRead(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.inbox.markRead(session.businessId, id);
  }
}

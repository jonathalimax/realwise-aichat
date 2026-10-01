import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

type VisitorContext = Partial<VisitorSessionClaims> & { visitorToken?: string };

function assertBusinessMatch(visitor: VisitorContext, businessId: string) {
  if (visitor.businessId && visitor.businessId !== businessId) {
    throw new ForbiddenException("Visitor session does not belong to this business");
  }
}

@UseGuards(VisitorSessionGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(":businessId/chips")
  chips(@Param("businessId") businessId: string) {
    return this.chat.initialChips(businessId);
  }

  @Post(":businessId/conversations")
  startConversation(@Param("businessId") businessId: string, @CurrentVisitor() visitor: VisitorContext) {
    assertBusinessMatch(visitor, businessId);
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.getOrCreateConversation(businessId, token, visitor.leadId);
  }

  @Post(":businessId/conversations/:conversationId/messages")
  sendMessage(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
    @CurrentVisitor() visitor: VisitorContext,
  ) {
    assertBusinessMatch(visitor, businessId);
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.sendMessage(businessId, conversationId, text, token, visitor.leadId);
  }

  @Post(":businessId/conversations/:conversationId/book")
  book(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("serviceName") serviceName: string,
    @Body("startsAt") startsAt: string,
    @Body("endsAt") endsAt: string,
    @CurrentVisitor() visitor: VisitorContext,
  ) {
    assertBusinessMatch(visitor, businessId);
    return this.chat.bookAppointment(businessId, conversationId, visitor.leadId, serviceName, startsAt, endsAt);
  }
}

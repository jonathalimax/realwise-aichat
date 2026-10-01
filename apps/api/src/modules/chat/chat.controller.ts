import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

@UseGuards(VisitorSessionGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(":businessId/chips")
  chips(@Param("businessId") businessId: string) {
    return this.chat.initialChips(businessId);
  }

  @Post(":businessId/conversations")
  startConversation(@Param("businessId") businessId: string, @CurrentVisitor() visitor: VisitorSessionClaims & { visitorToken?: string }) {
    const token = (visitor as any).visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.getOrCreateConversation(businessId, token, visitor.leadId);
  }

  @Post(":businessId/conversations/:conversationId/messages")
  sendMessage(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
  ) {
    return this.chat.sendMessage(businessId, conversationId, text);
  }
}

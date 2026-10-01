import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ChatService } from "./chat.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

type VisitorContext = Partial<VisitorSessionClaims> & { visitorToken?: string };

// A visitor session cookie from a different business's chat link (e.g. the browser previously
// chatted with another tenant) must never block the request — downgrade to a fresh anonymous
// identity scoped to the current business instead of denying service with a hard error.
function resolveVisitor(visitor: VisitorContext, businessId: string): VisitorContext {
  if (visitor.businessId && visitor.businessId !== businessId) {
    return { visitorToken: randomUUID() };
  }
  return visitor;
}

@UseGuards(VisitorSessionGuard, RateLimitGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(":businessId/chips")
  chips(@Param("businessId") businessId: string) {
    return this.chat.initialChips(businessId);
  }

  @Post(":businessId/conversations")
  startConversation(@Param("businessId") businessId: string, @CurrentVisitor() rawVisitor: VisitorContext) {
    const visitor = resolveVisitor(rawVisitor, businessId);
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.getOrCreateConversation(businessId, token, visitor.leadId);
  }

  @Post(":businessId/conversations/:conversationId/messages")
  sendMessage(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
    @CurrentVisitor() rawVisitor: VisitorContext,
  ) {
    const visitor = resolveVisitor(rawVisitor, businessId);
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
    @CurrentVisitor() rawVisitor: VisitorContext,
  ) {
    const visitor = resolveVisitor(rawVisitor, businessId);
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.bookAppointment(businessId, conversationId, visitor.leadId, serviceName, startsAt, endsAt, token);
  }
}

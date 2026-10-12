import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PushService } from "./push.service";
import { ChatService } from "../chat/chat.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

type VisitorContext = Partial<VisitorSessionClaims> & { visitorToken?: string };

@UseGuards(VisitorSessionGuard, RateLimitGuard)
@Controller("chat")
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly chat: ChatService,
  ) {}

  @Get(":businessId/push/public-key")
  getPublicKey() {
    return { publicKey: this.push.publicKey() };
  }

  @Post(":businessId/conversations/:conversationId/push/subscribe")
  async subscribe(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    @Query("t") resumeToken: string | undefined,
    @CurrentVisitor() visitor: VisitorContext,
    @Headers("user-agent") userAgent: string | undefined,
  ) {
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    await this.chat.assertVisitorOwnsConversation(businessId, conversationId, token, visitor.leadId, resumeToken);

    if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      throw new BadRequestException("Invalid push subscription payload");
    }

    await this.push.subscribe(
      businessId,
      conversationId,
      { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } },
      userAgent,
    );
    return { ok: true };
  }

  @Post(":businessId/conversations/:conversationId/push/unsubscribe")
  async unsubscribe(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("endpoint") endpoint: string,
    @Query("t") resumeToken: string | undefined,
    @CurrentVisitor() visitor: VisitorContext,
  ) {
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    await this.chat.assertVisitorOwnsConversation(businessId, conversationId, token, visitor.leadId, resumeToken);

    if (!endpoint) throw new BadRequestException("Missing endpoint");
    await this.push.unsubscribe(conversationId, endpoint);
    return { ok: true };
  }
}

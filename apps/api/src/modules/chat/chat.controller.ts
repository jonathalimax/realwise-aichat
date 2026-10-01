import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ChatService } from "./chat.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

type VisitorContext = Partial<VisitorSessionClaims> & { visitorToken?: string };

@UseGuards(VisitorSessionGuard, RateLimitGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(":businessId/chips")
  chips(@Param("businessId") businessId: string) {
    return this.chat.initialChips(businessId);
  }

  @Post(":businessId/conversations")
  startConversation(@Param("businessId") businessId: string, @CurrentVisitor() visitor: VisitorContext) {
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
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.sendMessage(businessId, conversationId, text, token, visitor.leadId);
  }

  @Post(":businessId/conversations/:conversationId/messages/stream")
  async streamMessage(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
    @CurrentVisitor() visitor: VisitorContext,
    @Res() res: Response,
  ) {
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const result = await this.chat.streamMessage(
        businessId,
        conversationId,
        text,
        token,
        (delta) => send("delta", { text: delta }),
        visitor.leadId,
        controller.signal,
      );
      send("done", result);
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : "stream_failed" });
    }
    res.end();
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
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.bookAppointment(businessId, conversationId, visitor.leadId, serviceName, startsAt, endsAt, token);
  }
}

import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import type { VisitorSessionClaims } from "@realwise/auth";

type VisitorContext = Partial<VisitorSessionClaims> & { visitorToken?: string };

@UseGuards(VisitorSessionGuard, RateLimitGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly flow: FlowService) {}

  @Post(":businessId/conversations")
  startConversation(@Param("businessId") businessId: string, @CurrentVisitor() visitor: VisitorContext) {
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    return this.chat.getOrCreateConversation(businessId, token, visitor.leadId);
  }

  @Get(":businessId/conversations/:conversationId/messages")
  async getHistory(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Query("t") resumeToken: string | undefined,
    @CurrentVisitor() visitor: VisitorContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;
    const history = await this.chat.getHistory(businessId, conversationId, token, visitor.leadId, resumeToken);
    // A resume-token open on a device/browser without the matching anon cookie — pin this
    // business's anon cookie to the conversation's real visitor token so subsequent same-device
    // requests (send message, book, etc.) keep resolving to the same conversation.
    if (history.resumedViaToken) {
      res.cookie(`rw_visitor_anon_${businessId}`, history.conversation.visitorToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 3600 * 1000,
      });
    }
    return history;
  }

  @Post(":businessId/conversations/:conversationId/messages")
  sendMessage(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
    @CurrentVisitor() visitor: VisitorContext,
  ) {
    if (!text?.trim()) throw new BadRequestException("Message text cannot be empty");
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
    if (!text?.trim()) throw new BadRequestException("Message text cannot be empty");
    const token = visitor.visitorToken ?? `${visitor.businessId}-${visitor.leadId}`;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();
    // Prime the connection immediately: the client parser at apps/chat/src/lib/api.ts skips any
    // frame without both `event:` and `data:` fields, so a bare SSE comment is a harmless no-op
    // for the client but guarantees bytes leave the server well before the first real delta
    // arrives (3-10s later from retrieval+LLM) — this is what prevents any buffering proxy or
    // flaky mobile connection from holding the whole response until then.
    res.write(":ok\n\n");
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat so the connection never looks idle to any intermediary while retrieval+LLM work.
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      res.write(":hb\n\n");
    }, 15000);

    const controller = new AbortController();
    res.on("close", () => {
      clearInterval(heartbeat);
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
      console.error("[ChatController] streamMessage failed", error);
      send("error", { message: "stream_failed" });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  @Post(":businessId/conversations/:conversationId/flow/start")
  startFlow(@Param("businessId") businessId: string, @Param("conversationId") conversationId: string) {
    return this.flow.start(businessId, conversationId);
  }

  @Post(":businessId/conversations/:conversationId/flow/advance")
  advanceFlow(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @Body("goto") goto: string,
    @Body("params") params: Record<string, unknown>,
    @Body("label") label: string | undefined,
  ) {
    return this.flow.advance(businessId, conversationId, goto, params ?? {}, label);
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

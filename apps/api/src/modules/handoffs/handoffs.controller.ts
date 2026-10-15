import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { HandoffsService } from "./handoffs.service";
import { KnowledgeQaService } from "../knowledge/knowledge-qa.service";

@Controller("handoffs")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("atendimento", "view")
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService, private readonly knowledgeQa: KnowledgeQaService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: { status?: string; limit?: string; cursor?: string }) {
    return this.handoffs.list(m.businessId, q, m);
  }

  /** Listable products for the pharmacist reply picker (declared before ":id" so it is not read as an id). */
  @Get("products/search")
  searchProducts(@CurrentMember() m: MemberContext, @Query() q: { q?: string; ids?: string }) {
    return this.handoffs.searchProducts(m.businessId, q);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.get(m.businessId, id, m);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/reply")
  reply(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { text?: string; productIds?: string[]; note?: string }) {
    return this.handoffs.reply(m, id, body);
  }

  /** General question answered AND saved to the knowledge base in one step (the dashboard's "Responder e salvar na base"). */
  @RequirePermission("atendimento", "edit")
  @Post(":id/answer-and-save")
  answerAndSave(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { answer?: unknown; question?: unknown; saveToKb?: unknown }) {
    return this.knowledgeQa.answerOpenQuestion(m, id, body ?? {}, (text) => this.handoffs.reply(m, id, { text }));
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/chat-link")
  chatLink(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.chatLink(m, id);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/close")
  close(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.close(m, id);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/whatsapp/draft")
  whatsappDraft(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.whatsappDraft(m, id);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/start")
  start(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body("channel") channel?: string) {
    return this.handoffs.start(m, id, channel);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/mark-answered")
  markAnswered(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.markAnswered(m, id);
  }
}

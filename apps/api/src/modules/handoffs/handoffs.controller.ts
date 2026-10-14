import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { HandoffsService } from "./handoffs.service";

@Controller("handoffs")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("atendimento", "view")
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: { status?: string; limit?: string; cursor?: string }) {
    return this.handoffs.list(m.businessId, q, m);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.handoffs.get(m.businessId, id, m);
  }

  @RequirePermission("atendimento", "edit")
  @Post(":id/reply")
  reply(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body("text") text: string) {
    return this.handoffs.reply(m, id, text);
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

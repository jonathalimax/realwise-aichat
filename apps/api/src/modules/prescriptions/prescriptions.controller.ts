import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { CurrentMember, CurrentVisitor } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { CommerceModeGuard } from "../access/commerce-mode.guard";
import { RequireCrf, RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { PrescriptionsService, RX_MAX_BYTES } from "./prescriptions.service";

@Controller("prescriptions")
@UseGuards(BusinessSessionGuard, PermissionsGuard, CommerceModeGuard)
@RequirePermission("receitas", "view")
export class PrescriptionsController {
  constructor(private readonly rx: PrescriptionsService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: { status?: string; q?: string; limit?: string; cursor?: string }) {
    return this.rx.list(m, q);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.rx.get(m, id);
  }

  /** Private, access-checked bytes: never cached, never sniffed, never a public URL. */
  @Get(":id/file")
  async file(@CurrentMember() m: MemberContext, @Param("id") id: string, @Res() res: Response) {
    const { data, mime } = await this.rx.file(m, id);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.send(data);
  }

  @RequirePermission("receitas", "edit")
  @RequireCrf()
  @Post(":id/approve")
  approve(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.rx.approve(m, id);
  }

  @RequirePermission("receitas", "edit")
  @RequireCrf()
  @Post(":id/reject")
  reject(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body("reason") reason: string) {
    return this.rx.reject(m, id, reason);
  }
}

/** Visitor-side upload (widget). The file goes to the private tree; nothing is chunked or embedded. */
@Controller("chat/:businessId/conversations/:conversationId/prescriptions")
@UseGuards(VisitorSessionGuard, RateLimitGuard, CommerceModeGuard)
export class PrescriptionUploadController {
  constructor(private readonly rx: PrescriptionsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: RX_MAX_BYTES + 1 } }))
  upload(
    @Param("businessId") businessId: string,
    @Param("conversationId") conversationId: string,
    @CurrentVisitor() visitor: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { consent?: string; patientName?: string },
    @Req() req: Request,
  ) {
    return this.rx.upload({ businessId, conversationId, visitor, file, consent: body?.consent, patientName: body?.patientName, ip: req.ip, userAgent: req.headers["user-agent"] });
  }
}

@Controller("internal/pharmacy")
@UseGuards(InternalTokenGuard)
export class RetentionJobsController {
  constructor(private readonly rx: PrescriptionsService) {}

  @Post("retention-purge")
  purge() {
    return this.rx.runRetentionPurge();
  }
}

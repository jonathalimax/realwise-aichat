import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { BusinessesService } from "./businesses.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness, CurrentMember } from "../../common/decorators/current-business.decorator";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("businesses")
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly accessLog: AccessLogService,
  ) {}

  @UseGuards(RateLimitGuard)
  @Get("public/:slug")
  getPublic(@Param("slug") slug: string) {
    return this.businesses.getBySlug(slug);
  }

  @UseGuards(RateLimitGuard)
  @Get("slug-available/:slug")
  slugAvailable(@Param("slug") slug: string) {
    return this.businesses.isSlugAvailable(slug);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @Get("me")
  getMe(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.getOwnBusiness(session.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Patch("me")
  updateMe(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: any) {
    return this.businesses.updateProfile(session.businessId, body);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("me/publish")
  publish(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.publish(session.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("me/link-placed")
  confirmLinkPlaced(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.confirmLinkPlaced(session.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "view")
  @Get("me/whatsapp-numbers")
  listWhatsappNumbers(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.listWhatsappNumbers(session.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("me/whatsapp-numbers")
  addWhatsappNumber(@CurrentBusiness() session: BusinessSessionClaims, @Body("label") label: string, @Body("phone") phone: string) {
    return this.businesses.addWhatsappNumber(session.businessId, label, phone);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Patch("me/whatsapp-numbers/:id")
  updateWhatsappNumber(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Param("id") id: string,
    @Body("label") label: string,
    @Body("phone") phone: string,
  ) {
    return this.businesses.updateWhatsappNumber(session.businessId, id, label, phone);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Delete("me/whatsapp-numbers/:id")
  removeWhatsappNumber(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.businesses.removeWhatsappNumber(session.businessId, id);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Patch("me/slug")
  setSlug(@CurrentBusiness() session: BusinessSessionClaims, @Body("slug") slug: string) {
    return this.businesses.setSlug(session.businessId, slug);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "view")
  @Get("me/branding")
  getBranding(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.getBranding(session.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Patch("me/branding")
  async updateBranding(@CurrentMember() member: MemberContext, @Body() body: any) {
    return this.saveBranding(member, body);
  }

  /** PUT alias of PATCH (the pharmacy dashboard "Aparência" tab uses PUT). */
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Put("me/branding")
  async putBranding(@CurrentMember() member: MemberContext, @Body() body: any) {
    return this.saveBranding(member, body);
  }

  private async saveBranding(member: MemberContext, body: any) {
    const result = await this.businesses.updateBranding(member.businessId, body ?? {});
    await this.accessLog.record({ businessId: member.businessId, actor: member, action: "branding.update", summary: "Atualizou a identidade visual" });
    return result;
  }

  /** Logo upload: png / jpeg / webp / svg up to 1 MB, served by GET /public/businesses/:businessId/logo. */
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Post("me/branding/logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 1024 * 1024 + 1 } }))
  async uploadLogo(@CurrentMember() member: MemberContext, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "FILE_REQUIRED", message: "Envie uma imagem." });
    if (file.buffer.length > 1024 * 1024) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "FILE_TOO_LARGE", message: "O logo deve ter até 1 MB." });
    const result = await this.businesses.setLogoFile(member.businessId, file.buffer);
    await this.accessLog.record({ businessId: member.businessId, actor: member, action: "branding.update", summary: "Atualizou o logo" });
    return result;
  }
}

@Controller("public/businesses")
export class PublicBusinessAssetsController {
  constructor(private readonly businesses: BusinessesService) {}

  @UseGuards(RateLimitGuard)
  @Get(":businessId/logo")
  async logo(@Param("businessId") businessId: string, @Res() res: Response) {
    const { data, mime } = await this.businesses.readLogoFile(businessId);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // An uploaded SVG must never run script if opened directly.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(data);
  }
}

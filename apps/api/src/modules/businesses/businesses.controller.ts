import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { BusinessesService } from "./businesses.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("businesses")
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

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
  updateBranding(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: any) {
    return this.businesses.updateBranding(session.businessId, body ?? {});
  }

  /** PUT alias of PATCH (the pharmacy dashboard "Aparência" tab uses PUT). */
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission(["configuracoes", "farmacia"], "edit")
  @Put("me/branding")
  putBranding(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: any) {
    return this.businesses.updateBranding(session.businessId, body ?? {});
  }
}

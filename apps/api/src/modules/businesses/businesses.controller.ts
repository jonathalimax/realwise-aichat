import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { BusinessesService } from "./businesses.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("businesses")
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get("public/:slug")
  getPublic(@Param("slug") slug: string) {
    return this.businesses.getBySlug(slug);
  }

  @Get("slug-available/:slug")
  slugAvailable(@Param("slug") slug: string) {
    return this.businesses.isSlugAvailable(slug);
  }

  @UseGuards(BusinessSessionGuard)
  @Get("me")
  getMe(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.getOwnBusiness(session.businessId);
  }

  @UseGuards(BusinessSessionGuard)
  @Patch("me")
  updateMe(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: any) {
    return this.businesses.updateProfile(session.businessId, body);
  }

  @UseGuards(BusinessSessionGuard)
  @Post("me/publish")
  publish(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.publish(session.businessId);
  }

  @UseGuards(BusinessSessionGuard)
  @Post("me/link-placed")
  confirmLinkPlaced(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.confirmLinkPlaced(session.businessId);
  }

  @UseGuards(BusinessSessionGuard)
  @Get("me/whatsapp-numbers")
  listWhatsappNumbers(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.businesses.listWhatsappNumbers(session.businessId);
  }

  @UseGuards(BusinessSessionGuard)
  @Post("me/whatsapp-numbers")
  addWhatsappNumber(@CurrentBusiness() session: BusinessSessionClaims, @Body("label") label: string, @Body("phone") phone: string) {
    return this.businesses.addWhatsappNumber(session.businessId, label, phone);
  }

  @UseGuards(BusinessSessionGuard)
  @Delete("me/whatsapp-numbers/:id")
  removeWhatsappNumber(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.businesses.removeWhatsappNumber(session.businessId, id);
  }

  @UseGuards(BusinessSessionGuard)
  @Patch("me/slug")
  setSlug(@CurrentBusiness() session: BusinessSessionClaims, @Body("slug") slug: string) {
    return this.businesses.setSlug(session.businessId, slug);
  }

  @UseGuards(BusinessSessionGuard)
  @Patch("me/branding")
  updateBranding(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: { logoUrl?: string; brandColor?: string }) {
    return this.businesses.updateBranding(session.businessId, body);
  }
}

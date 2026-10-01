import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
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
}

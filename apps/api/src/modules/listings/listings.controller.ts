import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ListingsService } from "./listings.service";
import { ListingExtractionService } from "./listing-extraction.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("listings")
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly extraction: ListingExtractionService,
  ) {}

  @Get()
  list(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Query("status") status?: string,
    @Query("listingType") listingType?: string,
  ) {
    return this.listings.listForOwner(session.businessId, { status, listingType });
  }

  @Get(":id")
  getOne(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.listings.getOne(session.businessId, id);
  }

  @Patch(":id")
  update(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string, @Body() data: Record<string, unknown>) {
    return this.listings.update(session.businessId, id, data);
  }

  @Post()
  create(@CurrentBusiness() session: BusinessSessionClaims, @Body() data: Record<string, unknown>) {
    return this.listings.create(session.businessId, data);
  }

  @Delete(":id")
  remove(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.listings.softDelete(session.businessId, id);
  }

  @Post("extract")
  extract(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.extraction.extractForBusiness(session.businessId);
  }
}

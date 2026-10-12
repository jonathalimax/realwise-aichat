import { Module } from "@nestjs/common";
import { ListingExtractionService } from "./listing-extraction.service";
import { ListingsService } from "./listings.service";
import { ListingsController } from "./listings.controller";

@Module({
  controllers: [ListingsController],
  providers: [ListingExtractionService, ListingsService],
  exports: [ListingExtractionService, ListingsService],
})
export class ListingsModule {}

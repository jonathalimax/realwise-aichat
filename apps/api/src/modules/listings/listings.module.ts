import { Module } from "@nestjs/common";
import { ListingExtractionService } from "./listing-extraction.service";

@Module({
  providers: [ListingExtractionService],
  exports: [ListingExtractionService],
})
export class ListingsModule {}

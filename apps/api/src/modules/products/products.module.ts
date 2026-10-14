import { Module } from "@nestjs/common";
import { ClassReviewController, ProductsController, PublicProductImageController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ClassReviewService } from "./class-review.service";

@Module({
  controllers: [ProductsController, PublicProductImageController, ClassReviewController],
  providers: [ProductsService, ClassReviewService],
  exports: [ProductsService, ClassReviewService],
})
export class ProductsModule {}

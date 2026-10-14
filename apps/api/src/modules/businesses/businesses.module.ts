import { Module } from "@nestjs/common";
import { BusinessesController, PublicBusinessAssetsController } from "./businesses.controller";
import { BusinessesService } from "./businesses.service";

@Module({
  controllers: [BusinessesController, PublicBusinessAssetsController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}

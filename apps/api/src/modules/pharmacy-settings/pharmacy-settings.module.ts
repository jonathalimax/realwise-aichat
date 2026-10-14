import { Module } from "@nestjs/common";
import { PharmacySettingsController } from "./pharmacy-settings.controller";
import { PharmacySettingsService } from "./pharmacy-settings.service";

@Module({
  controllers: [PharmacySettingsController],
  providers: [PharmacySettingsService],
  exports: [PharmacySettingsService],
})
export class PharmacySettingsModule {}

import { Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
import { ChatModule } from "../chat/chat.module";
import { PharmacySettingsModule } from "../pharmacy-settings/pharmacy-settings.module";

@Module({
  imports: [ChatModule, PharmacySettingsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}

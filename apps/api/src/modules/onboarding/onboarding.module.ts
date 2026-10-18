import { Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
import { ChatModule } from "../chat/chat.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { PharmacySettingsModule } from "../pharmacy-settings/pharmacy-settings.module";

@Module({
  imports: [ChatModule, PharmacySettingsModule, KnowledgeModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}

import { Module } from "@nestjs/common";
import { InternalController } from "./internal.controller";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [OnboardingModule, ChatModule],
  controllers: [InternalController],
})
export class InternalModule {}

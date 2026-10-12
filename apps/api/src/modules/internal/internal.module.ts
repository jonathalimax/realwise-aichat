import { Module } from "@nestjs/common";
import { InternalController } from "./internal.controller";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { ChatModule } from "../chat/chat.module";
import { ListingsModule } from "../listings/listings.module";

@Module({
  imports: [OnboardingModule, ChatModule, ListingsModule],
  controllers: [InternalController],
})
export class InternalModule {}

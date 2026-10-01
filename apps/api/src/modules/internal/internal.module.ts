import { Module } from "@nestjs/common";
import { InternalController } from "./internal.controller";
import { OnboardingModule } from "../onboarding/onboarding.module";

@Module({
  imports: [OnboardingModule],
  controllers: [InternalController],
})
export class InternalModule {}

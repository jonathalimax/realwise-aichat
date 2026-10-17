import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminOnboardingService } from "./admin-onboarding.service";
import { ListingsModule } from "../listings/listings.module";

@Module({
  imports: [ListingsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminOnboardingService],
})
export class AdminModule {}

import { Module } from "@nestjs/common";
import { UsageService } from "./usage.service";

@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}

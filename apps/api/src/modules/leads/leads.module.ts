import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { TeamSummaryService } from "./team-summary.service";

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, TeamSummaryService],
  exports: [LeadsService, TeamSummaryService],
})
export class LeadsModule {}

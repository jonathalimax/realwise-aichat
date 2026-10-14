import { Module } from "@nestjs/common";
import { MemberRecoveryController, TeamController } from "./team.controller";
import { TeamService } from "./team.service";

@Module({
  controllers: [TeamController, MemberRecoveryController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}

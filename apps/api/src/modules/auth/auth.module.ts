import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [LeadsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

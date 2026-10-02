import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { BookingsModule } from "../bookings/bookings.module";
import { CalendarModule } from "../calendar/calendar.module";
import { LeadsModule } from "../leads/leads.module";
import { AlertsModule } from "../alerts/alerts.module";
import { UsageModule } from "../usage/usage.module";

@Module({
  imports: [BookingsModule, CalendarModule, LeadsModule, AlertsModule, UsageModule],
  controllers: [ChatController],
  providers: [ChatService, FlowService],
  exports: [ChatService, FlowService],
})
export class ChatModule {}

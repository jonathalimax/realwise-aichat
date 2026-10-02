import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { BookingsModule } from "../bookings/bookings.module";
import { CalendarModule } from "../calendar/calendar.module";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [BookingsModule, CalendarModule, LeadsModule],
  controllers: [ChatController],
  providers: [ChatService, FlowService],
  exports: [ChatService, FlowService],
})
export class ChatModule {}

import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { BookingsModule } from "../bookings/bookings.module";
import { CalendarModule } from "../calendar/calendar.module";
import { LeadsModule } from "../leads/leads.module";
import { AlertsModule } from "../alerts/alerts.module";
import { UsageModule } from "../usage/usage.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ListingsModule } from "../listings/listings.module";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [BookingsModule, CalendarModule, LeadsModule, AlertsModule, UsageModule, KnowledgeModule, ListingsModule, AnalyticsModule],
  controllers: [ChatController],
  providers: [ChatService, FlowService],
  exports: [ChatService, FlowService],
})
export class ChatModule {}

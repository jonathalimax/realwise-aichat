import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { FinancingRatesService } from "./financing-rates.service";
import { SimulatorService } from "./simulator.service";
import { BookingsModule } from "../bookings/bookings.module";
import { CalendarModule } from "../calendar/calendar.module";
import { LeadsModule } from "../leads/leads.module";
import { AlertsModule } from "../alerts/alerts.module";
import { UsageModule } from "../usage/usage.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ListingsModule } from "../listings/listings.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CustomersModule } from "../customers/customers.module";
import { ChatHumanService } from "./chat-human.service";
import { PharmacyChatService } from "./pharmacy/pharmacy-chat.service";
import { AlertsPharmacyNotifier, PrismaPharmacyHandoffs, PrismaPharmacyOrders } from "./pharmacy/ports";
import { PHARMACY_HANDOFFS_PORT, PHARMACY_NOTIFIER_PORT, PHARMACY_ORDERS_PORT } from "./pharmacy/types";

@Module({
  imports: [BookingsModule, CalendarModule, LeadsModule, AlertsModule, UsageModule, KnowledgeModule, ListingsModule, AnalyticsModule, CustomersModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    FlowService,
    FinancingRatesService,
    SimulatorService,
    ChatHumanService,
    PharmacyChatService,
    // Prisma-direct default ports of the pharmacy chat engine. Bind PHARMACY_ORDERS_PORT to 2b's
    // OrdersService.createFromCart (same shape, API.md 8.3) to swap the implementation.
    PrismaPharmacyOrders,
    PrismaPharmacyHandoffs,
    AlertsPharmacyNotifier,
    { provide: PHARMACY_ORDERS_PORT, useExisting: PrismaPharmacyOrders },
    { provide: PHARMACY_HANDOFFS_PORT, useExisting: PrismaPharmacyHandoffs },
    { provide: PHARMACY_NOTIFIER_PORT, useExisting: AlertsPharmacyNotifier },
  ],
  exports: [ChatService, FlowService, FinancingRatesService, SimulatorService, ChatHumanService, PharmacyChatService],
})
export class ChatModule {}

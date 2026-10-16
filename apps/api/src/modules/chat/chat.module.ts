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
import { OrdersModule } from "../orders/orders.module";
import { OrdersService } from "../orders/orders.service";
import { PharmacyNotificationsService } from "../pharmacy-notifications/pharmacy-notifications.service";
import { ChatHumanService } from "./chat-human.service";
import { PharmacyChatService } from "./pharmacy/pharmacy-chat.service";
import { AlertsPharmacyNotifier, PrismaPharmacyHandoffs, PrismaPharmacyOrders } from "./pharmacy/ports";
import { PHARMACY_HANDOFFS_PORT, PHARMACY_NOTIFIER_PORT, PHARMACY_ORDERS_PORT } from "./pharmacy/types";

@Module({
  imports: [BookingsModule, CalendarModule, LeadsModule, AlertsModule, UsageModule, KnowledgeModule, ListingsModule, AnalyticsModule, CustomersModule, OrdersModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    FlowService,
    FinancingRatesService,
    SimulatorService,
    ChatHumanService,
    PharmacyChatService,
    // The engine's ports are bound to the real domain services (wave 3): orders -> OrdersService.createFromCart
    // (writes its own alerts/e-mails, status events, atomic PED- counter), notifications -> PharmacyNotificationsService
    // (global module, one alert row per event so an urgent alert is never hidden by an older one).
    // The Prisma-direct classes stay as the documented fallback implementations (see test/pharmacy-bindings.test.ts).
    PrismaPharmacyOrders,
    PrismaPharmacyHandoffs,
    AlertsPharmacyNotifier,
    { provide: PHARMACY_ORDERS_PORT, useExisting: OrdersService },
    { provide: PHARMACY_HANDOFFS_PORT, useExisting: PrismaPharmacyHandoffs },
    { provide: PHARMACY_NOTIFIER_PORT, useExisting: PharmacyNotificationsService },
  ],
  exports: [ChatService, FlowService, FinancingRatesService, SimulatorService, ChatHumanService, PharmacyChatService],
})
export class ChatModule {}

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthController } from "./modules/health/health.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { BusinessesModule } from "./modules/businesses/businesses.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { SharedKnowledgeModule } from "./modules/shared-knowledge/shared-knowledge.module";
import { ChatModule } from "./modules/chat/chat.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { BillingModule } from "./modules/billing/billing.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ComplianceModule } from "./modules/compliance/compliance.module";
import { InternalModule } from "./modules/internal/internal.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { OwnerAssistantModule } from "./modules/owner-assistant/owner-assistant.module";
import { AlertsModule } from "./modules/alerts/alerts.module";
import { UsageModule } from "./modules/usage/usage.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { PushModule } from "./modules/push/push.module";
import { AccessModule } from "./modules/access/access.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { TeamModule } from "./modules/team/team.module";
import { PharmacySettingsModule } from "./modules/pharmacy-settings/pharmacy-settings.module";
import { PharmacyNotificationsModule } from "./modules/pharmacy-notifications/pharmacy-notifications.service";
import { ProductsModule } from "./modules/products/products.module";
import { CatalogImportModule } from "./modules/catalog-import/catalog-import.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PrescriptionsModule } from "./modules/prescriptions/prescriptions.module";
import { HandoffsModule } from "./modules/handoffs/handoffs.module";
import { PharmacyDashboardModule } from "./modules/pharmacy-dashboard/pharmacy-dashboard.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AccessModule,
    AuthModule,
    BusinessesModule,
    OnboardingModule,
    KnowledgeModule,
    SharedKnowledgeModule,
    ChatModule,
    LeadsModule,
    BookingsModule,
    BillingModule,
    AnalyticsModule,
    AdminModule,
    ComplianceModule,
    InternalModule,
    CalendarModule,
    OwnerAssistantModule,
    AlertsModule,
    UsageModule,
    InboxModule,
    PushModule,
    CustomersModule,
    // pharmacy niche, wave 2b (docs/pharmacy/API.md)
    TeamModule,
    PharmacySettingsModule,
    PharmacyNotificationsModule,
    ProductsModule,
    CatalogImportModule,
    OrdersModule,
    PrescriptionsModule,
    HandoffsModule,
    PharmacyDashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

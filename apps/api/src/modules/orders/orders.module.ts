import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { PharmacySettingsModule } from "../pharmacy-settings/pharmacy-settings.module";
import { OrdersController, PharmacyOrderJobsController, PublicOrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [CustomersModule, PharmacySettingsModule],
  controllers: [OrdersController, PublicOrdersController, PharmacyOrderJobsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { PharmacySettingsModule } from "../pharmacy-settings/pharmacy-settings.module";
import { PrescriptionUploadController, PrescriptionsController, RetentionJobsController } from "./prescriptions.controller";
import { PrescriptionsService } from "./prescriptions.service";

@Module({
  imports: [OrdersModule, PharmacySettingsModule],
  controllers: [PrescriptionsController, PrescriptionUploadController, RetentionJobsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}

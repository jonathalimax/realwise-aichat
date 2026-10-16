import { Module } from "@nestjs/common";
import { CEP_LOOKUP, defaultCepLookup } from "./cep-lookup";
import { CustomerProfileService } from "./customer-profile.service";
import { CustomersController } from "./customers.controller";
import { CustomersAdminController } from "./customers-admin.controller";
import { CustomersAdminService } from "./customers-admin.service";

@Module({
  controllers: [CustomersController, CustomersAdminController],
  providers: [{ provide: CEP_LOOKUP, useFactory: () => defaultCepLookup() }, CustomerProfileService, CustomersAdminService],
  exports: [CustomerProfileService],
})
export class CustomersModule {}

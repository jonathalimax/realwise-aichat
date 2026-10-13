import { Module } from "@nestjs/common";
import { CEP_LOOKUP, defaultCepLookup } from "./cep-lookup";
import { CustomerProfileService } from "./customer-profile.service";
import { CustomersController } from "./customers.controller";

@Module({
  controllers: [CustomersController],
  providers: [{ provide: CEP_LOOKUP, useFactory: () => defaultCepLookup() }, CustomerProfileService],
  exports: [CustomerProfileService],
})
export class CustomersModule {}

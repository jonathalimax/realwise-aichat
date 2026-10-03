import { Module } from "@nestjs/common";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { AvailabilityController } from "./availability.controller";
import { AvailabilityService } from "./availability.service";

@Module({
  controllers: [BookingsController, AvailabilityController],
  providers: [BookingsService, AvailabilityService],
  exports: [BookingsService, AvailabilityService],
})
export class BookingsModule {}

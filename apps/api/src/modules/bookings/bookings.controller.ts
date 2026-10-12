import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { BookingsService } from "./bookings.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get("slots")
  listSlots(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.bookings.listSlots(session.businessId);
  }

  @Post("slots")
  createSlotRule(@CurrentBusiness() session: BusinessSessionClaims, @Body() body: any) {
    return this.bookings.createSlotRule(session.businessId, body);
  }

  @Get("appointments")
  listAppointments(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.bookings.listAppointments(session.businessId);
  }

  @Patch("appointments/:id/status")
  updateStatus(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Param("id") id: string,
    @Body("status") status: "confirmed" | "canceled" | "no_show" | "completed",
  ) {
    return this.bookings.updateStatus(session.businessId, id, status);
  }
}

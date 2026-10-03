import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { sendEmail } from "../../common/email";
import { buildIcs } from "../../common/ics";
import { formatListingAddress, renderOwnerEmail, renderVisitorEmail } from "./booking-notifications";
import type { AppointmentType } from "@realwise/db";

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSlots(businessId: string) {
    return this.prisma.client.bookingSlot.findMany({ where: { businessId, isBlocked: false } });
  }

  async createSlotRule(businessId: string, data: { weekday: number; startTime: string; endTime: string; slotDurationMinutes: number; capacity?: number }) {
    return this.prisma.client.bookingSlot.create({
      data: { businessId, kind: "recurring", ...data },
    });
  }

  async createAppointment(
    businessId: string,
    leadId: string | undefined,
    conversationId: string | undefined,
    serviceName: string,
    startsAt: Date,
    endsAt: Date,
    createdVia: "chat" | "dashboard",
    // Defaults to the schema's own default ("presencial") to preserve existing callers' behavior —
    // FlowService's real slot-backed booking nodes explicitly pass "visita_local" since that's the
    // AppointmentType AvailabilityService.computeSlots was queried with.
    appointmentType?: AppointmentType,
  ) {
    return this.prisma.client.appointment.create({
      data: {
        businessId,
        leadId,
        conversationId,
        serviceName,
        startsAt,
        endsAt,
        createdVia,
        status: "pending",
        ...(appointmentType ? { appointmentType } : {}),
      },
    });
  }

  // Shared create-and-notify core used both by ChatService's free-text "agendar" booking-card path
  // and by FlowService's scripted visita_confirmada/agend_ok booking nodes — lives here (rather
  // than duplicated in each caller, or inline in ChatService as it used to be) so FlowService can
  // reach the real DB write without creating a FlowService <-> ChatService import cycle (FlowService
  // is already imported BY ChatService). Calendar sync still happens in each caller, since
  // BookingsModule can't import CalendarModule without creating a module-level cycle the other way
  // (CalendarModule already imports BookingsModule).
  async createAppointmentAndNotify(
    businessId: string,
    leadId: string | undefined,
    conversationId: string | undefined,
    serviceName: string,
    startsAt: Date,
    endsAt: Date,
    createdVia: "chat" | "dashboard",
    appointmentType?: AppointmentType,
    listingId?: string | null,
  ) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    const listing = listingId
      ? await this.prisma.client.listing.findFirst({ where: { id: listingId, businessId, deletedAt: null } })
      : null;
    const locationAddress = formatListingAddress(listing) ?? business?.address ?? undefined;

    const appointment = await this.prisma.client.appointment.create({
      data: {
        businessId,
        leadId,
        conversationId,
        serviceName,
        startsAt,
        endsAt,
        createdVia,
        status: "pending",
        ...(appointmentType ? { appointmentType } : {}),
        ...(listingId ? { listingId } : {}),
        ...(locationAddress ? { locationAddress } : {}),
      },
    });

    await this.sendBookingEmails(appointment.id).catch(() => {});

    return appointment;
  }

  // Sends the owner + (if captured) visitor confirmation emails for an already-created
  // appointment, each real .ics-attached — each send is independently caught so one failure
  // never blocks the other or (via the caller) the appointment creation itself. `sendVisitorOnly`
  // lets FlowService's late visitor-email-capture path re-trigger just the visitor side without
  // re-notifying the owner a second time.
  async sendBookingEmails(appointmentId: string, opts?: { sendVisitorOnly?: boolean }): Promise<void> {
    const appointment = await this.prisma.client.appointment.findUnique({
      where: { id: appointmentId },
      include: { business: true, lead: true, listing: true },
    });
    if (!appointment) return;

    const { business, lead, listing } = appointment;
    const address = appointment.locationAddress ?? formatListingAddress(listing) ?? business.address ?? undefined;

    const ics = buildIcs({
      uid: appointment.id,
      summary: appointment.serviceName,
      description: listing?.description ?? appointment.serviceName,
      location: address,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      url: listing?.url ?? undefined,
    });
    const attachment = {
      filename: "agendamento.ics",
      content: Buffer.from(ics, "utf8").toString("base64"),
      contentType: "text/calendar; method=REQUEST",
    };

    if (!opts?.sendVisitorOnly && business.email) {
      const { subject, html } = renderOwnerEmail({
        business,
        lead,
        serviceName: appointment.serviceName,
        startsAt: appointment.startsAt,
        listing,
        address,
      });
      await sendEmail(business.email, subject, html, [attachment]).catch(() => {});
    }

    if (lead?.email) {
      const { subject, html } = renderVisitorEmail({
        business,
        serviceName: appointment.serviceName,
        startsAt: appointment.startsAt,
        listing,
        address,
      });
      await sendEmail(lead.email, subject, html, [attachment]).catch(() => {});
    }
  }

  async listAppointments(businessId: string) {
    return this.prisma.client.appointment.findMany({
      where: { businessId },
      include: { lead: { select: { name: true, phone: true } } },
      orderBy: { startsAt: "asc" },
    });
  }

  async updateStatus(businessId: string, appointmentId: string, status: "confirmed" | "canceled" | "no_show" | "completed") {
    const appointment = await this.prisma.client.appointment.findFirst({ where: { id: appointmentId, businessId } });
    if (!appointment) throw new NotFoundException("Appointment not found");
    return this.prisma.client.appointment.update({
      where: { id: appointmentId },
      data: { status, ownerConfirmedAt: status === "confirmed" ? new Date() : appointment.ownerConfirmedAt },
    });
  }
}

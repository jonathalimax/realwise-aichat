import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { sendEmail, escapeHtml } from "../../common/email";
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
  ) {
    const appointment = await this.createAppointment(businessId, leadId, conversationId, serviceName, startsAt, endsAt, createdVia, appointmentType);

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { email: true } });
    if (business?.email) {
      await sendEmail(
        business.email,
        `Novo agendamento: ${escapeHtml(serviceName)}`,
        `<p>Um cliente marcou <strong>${escapeHtml(serviceName)}</strong> para <strong>${escapeHtml(startsAt.toLocaleString("pt-BR"))}</strong>.</p>
         <p>Confira e confirme no painel: Agenda.</p>`,
      ).catch(() => {});
    }

    return appointment;
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

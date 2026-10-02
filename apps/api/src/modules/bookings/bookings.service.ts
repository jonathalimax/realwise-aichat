import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

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
  ) {
    return this.prisma.client.appointment.create({
      data: { businessId, leadId, conversationId, serviceName, startsAt, endsAt, createdVia, status: "pending" },
    });
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

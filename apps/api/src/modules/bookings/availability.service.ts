import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AppointmentType } from "@realwise/db";
import { dateKeyInZone, filterOpenSlots, generateSlotCandidates, MAX_RANGE_DAYS } from "./slot-generation";

export interface AvailabilityRuleInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  slotDurationMinutes: number;
  capacity?: number;
  appointmentType: AppointmentType;
  listingId?: string | null;
  kind?: string;
  exceptionDate?: string | Date | null;
  isBlocked?: boolean;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(businessId: string) {
    return this.prisma.client.bookingSlot.findMany({
      where: { businessId },
      orderBy: [{ appointmentType: "asc" }, { weekday: "asc" }],
    });
  }

  async upsertRule(businessId: string, data: AvailabilityRuleInput & { id?: string }) {
    if (data.listingId) {
      const listing = await this.prisma.client.listing.findFirst({ where: { id: data.listingId, businessId } });
      if (!listing) throw new NotFoundException("Listing not found");
    }

    const capacity = data.capacity ?? 1;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      throw new BadRequestException("capacity must be an integer between 1 and 50");
    }
    if (!Number.isInteger(data.slotDurationMinutes) || data.slotDurationMinutes < 15) {
      throw new BadRequestException("slotDurationMinutes must be an integer of at least 15");
    }

    const payload = {
      businessId,
      kind: data.kind ?? (data.exceptionDate ? "exception" : "recurring"),
      weekday: data.weekday ?? null,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      slotDurationMinutes: data.slotDurationMinutes,
      capacity,
      appointmentType: data.appointmentType,
      listingId: data.listingId ?? null,
      exceptionDate: data.exceptionDate ? new Date(data.exceptionDate) : null,
      isBlocked: data.isBlocked ?? false,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    };

    if (data.id) {
      const existing = await this.prisma.client.bookingSlot.findFirst({ where: { id: data.id, businessId } });
      if (!existing) throw new NotFoundException("Availability rule not found");
      return this.prisma.client.bookingSlot.update({ where: { id: data.id }, data: payload });
    }
    return this.prisma.client.bookingSlot.create({ data: payload });
  }

  async deleteRule(businessId: string, ruleId: string) {
    const existing = await this.prisma.client.bookingSlot.findFirst({ where: { id: ruleId, businessId } });
    if (!existing) throw new NotFoundException("Availability rule not found");
    await this.prisma.client.bookingSlot.delete({ where: { id: ruleId } });
    return { ok: true };
  }

  async computeSlots(
    businessId: string,
    params: { appointmentType: AppointmentType; listingId?: string | null; from: Date; to: Date },
  ): Promise<{ configured: boolean; slots: { startsAt: string; endsAt: string }[] }> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return { configured: false, slots: [] };
    const timezone = business.timezone ?? "America/Sao_Paulo";

    const allRules = await this.prisma.client.bookingSlot.findMany({ where: { businessId } });
    if (allRules.length === 0) return { configured: false, slots: [] };

    const typeRules = allRules.filter((r) => r.appointmentType === params.appointmentType);
    const candidates = generateSlotCandidates(typeRules, {
      from: params.from,
      to: params.to,
      timezone,
      listingId: params.listingId,
    });
    if (candidates.length === 0) return { configured: true, slots: [] };

    const cappedTo = new Date(Math.min(params.to.getTime(), params.from.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000));
    const existingAppointments = await this.prisma.client.appointment.findMany({
      where: {
        businessId,
        status: { not: "canceled" },
        startsAt: { gte: params.from, lte: cappedTo },
      },
      select: { startsAt: true, endsAt: true },
    });

    return { configured: true, slots: filterOpenSlots(candidates, existingAppointments) };
  }

  // Which appointment types this business has any recurring availability configured for — used to
  // pick "visita_local" vs the legacy default "presencial" for chat property visits.
  async configuredAppointmentTypes(businessId: string): Promise<string[]> {
    const rows = await this.prisma.client.bookingSlot.findMany({
      where: { businessId, kind: "recurring", isBlocked: false },
      select: { appointmentType: true },
      distinct: ["appointmentType"],
    });
    return rows.map((r) => r.appointmentType);
  }

  // Re-verified right before an Appointment is actually created (BookingsService.createAppointmentAndNotify)
  // — time passes between a slot being offered and the visitor confirming, so the slot capacity
  // computeSlots used to decide this slot was open may already be exhausted. Uses the SAME matching
  // predicate as computeSlots (businessId, appointmentType, weekday, time-of-day, listingId-or-null
  // preference, validFrom/validUntil, not isBlocked) so the two never drift apart. A business with no
  // rules configured for this appointmentType has no capacity restriction (matches computeSlots'
  // existing `configured: false` = unrestricted behavior) and is a no-op here.
  async checkCapacity(
    businessId: string,
    params: { appointmentType: AppointmentType; listingId?: string | null; startsAt: Date; endsAt: Date },
  ): Promise<void> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return;
    const timezone = business.timezone ?? "America/Sao_Paulo";

    const typeRules = await this.prisma.client.bookingSlot.findMany({
      where: { businessId, appointmentType: params.appointmentType, kind: "recurring", isBlocked: false },
    });
    if (typeRules.length === 0) return;

    const { weekday } = dateKeyInZone(params.startsAt, timezone);
    let candidateRules = typeRules.filter((r) => r.weekday === weekday);
    if (params.listingId) {
      const listingSpecific = candidateRules.filter((r) => r.listingId === params.listingId);
      candidateRules = listingSpecific.length > 0 ? listingSpecific : candidateRules.filter((r) => r.listingId === null);
    } else {
      candidateRules = candidateRules.filter((r) => r.listingId === null);
    }
    candidateRules = candidateRules.filter(
      (r) => (!r.validFrom || params.startsAt >= r.validFrom) && (!r.validUntil || params.startsAt <= r.validUntil),
    );

    const startHM = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(params.startsAt);
    const matchingRule = candidateRules.find((r) => r.startTime && r.endTime && startHM >= r.startTime && startHM < r.endTime);
    if (!matchingRule) return;

    const overlapping = await this.prisma.client.appointment.count({
      where: {
        businessId,
        status: { not: "canceled" },
        startsAt: { lt: params.endsAt },
        endsAt: { gt: params.startsAt },
      },
    });
    if (overlapping >= matchingRule.capacity) {
      throw new BadRequestException("Esse horário não tem mais vagas disponíveis.");
    }
  }
}

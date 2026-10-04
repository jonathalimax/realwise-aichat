import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AppointmentType } from "@realwise/db";

// Brazil has not observed DST since 2019, so every IANA zone we care about today is a fixed
// UTC offset. If a business ever needs a non-BR timezone, add it here rather than reaching for a
// full tz database dependency just for this.
const FIXED_OFFSET_MINUTES: Record<string, number> = {
  "America/Sao_Paulo": -180,
  "America/Manaus": -240,
  "America/Rio_Branco": -300,
  "America/Noronha": -120,
};

function offsetMinutesFor(timezone: string): number {
  return FIXED_OFFSET_MINUTES[timezone] ?? -180;
}

// Builds a UTC Date representing `hour:minute` on the given calendar day *in* `timezone`,
// without ever touching server-local time (Date.setHours is server-local and would be wrong on
// a server running outside America/Sao_Paulo).
function zonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const offsetMin = offsetMinutesFor(timezone);
  // Date.UTC with the wall-clock components, then shift by the zone's offset to land on the
  // correct UTC instant.
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - offsetMin * 60000);
}

function dateKeyInZone(date: Date, timezone: string): { year: number; month: number; day: number; weekday: number } {
  const offsetMin = offsetMinutesFor(timezone);
  const shifted = new Date(date.getTime() + offsetMin * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

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

const MAX_RANGE_DAYS = 14;
const MAX_SLOTS = 60;
const LEAD_TIME_MS = 2 * 60 * 60 * 1000;

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

    let activeRules = typeRules.filter((r) => r.kind === "recurring" && !r.isBlocked);
    if (params.listingId) {
      const listingSpecific = activeRules.filter((r) => r.listingId === params.listingId);
      activeRules = listingSpecific.length > 0 ? listingSpecific : activeRules.filter((r) => r.listingId === null);
    } else {
      activeRules = activeRules.filter((r) => r.listingId === null);
    }

    const blackoutDates = new Set(
      typeRules
        .filter((r) => r.isBlocked && r.exceptionDate)
        .map((r) => r.exceptionDate!.toISOString().slice(0, 10)),
    );

    const rangeMs = params.to.getTime() - params.from.getTime();
    const cappedTo = new Date(Math.min(params.to.getTime(), params.from.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000));
    void rangeMs;

    const candidates: { startsAt: Date; endsAt: Date; capacity: number }[] = [];
    const cursorDay = new Date(params.from);
    const now = new Date();
    const leadCutoff = new Date(now.getTime() + LEAD_TIME_MS);

    for (let i = 0; i < MAX_RANGE_DAYS; i += 1) {
      const probe = new Date(cursorDay.getTime() + i * 24 * 60 * 60 * 1000);
      if (probe > cappedTo) break;
      const { year, month, day, weekday } = dateKeyInZone(probe, timezone);
      const dayKey = zonedDateTime(year, month, day, 0, 0, timezone).toISOString().slice(0, 10);
      if (blackoutDates.has(dayKey)) continue;

      for (const rule of activeRules) {
        if (rule.weekday !== weekday) continue;
        if (!rule.startTime || !rule.endTime) continue;
        if (rule.validFrom && probe < rule.validFrom) continue;
        if (rule.validUntil && probe > rule.validUntil) continue;

        const [startH, startM] = rule.startTime.split(":").map(Number);
        const [endH, endM] = rule.endTime.split(":").map(Number);
        let cursor = zonedDateTime(year, month, day, startH, startM, timezone);
        const dayEnd = zonedDateTime(year, month, day, endH, endM, timezone);

        while (cursor.getTime() + rule.slotDurationMinutes * 60000 <= dayEnd.getTime()) {
          const slotStart = new Date(cursor);
          const slotEnd = new Date(cursor.getTime() + rule.slotDurationMinutes * 60000);
          if (slotStart >= leadCutoff) {
            candidates.push({ startsAt: slotStart, endsAt: slotEnd, capacity: rule.capacity });
          }
          cursor = new Date(cursor.getTime() + rule.slotDurationMinutes * 60000);
        }
      }
    }

    if (candidates.length === 0) return { configured: true, slots: [] };

    const existingAppointments = await this.prisma.client.appointment.findMany({
      where: {
        businessId,
        status: { not: "canceled" },
        startsAt: { gte: params.from, lte: cappedTo },
      },
      select: { startsAt: true, endsAt: true },
    });

    candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const openSlots: { startsAt: string; endsAt: string }[] = [];
    for (const candidate of candidates) {
      const bookedCount = existingAppointments.filter(
        (a) => a.startsAt.getTime() < candidate.endsAt.getTime() && a.endsAt.getTime() > candidate.startsAt.getTime(),
      ).length;
      if (bookedCount >= candidate.capacity) continue;
      openSlots.push({ startsAt: candidate.startsAt.toISOString(), endsAt: candidate.endsAt.toISOString() });
      if (openSlots.length >= MAX_SLOTS) break;
    }

    return { configured: true, slots: openSlots };
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

import { Injectable, NotFoundException } from "@nestjs/common";
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

    const payload = {
      businessId,
      kind: data.kind ?? (data.exceptionDate ? "exception" : "recurring"),
      weekday: data.weekday ?? null,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      slotDurationMinutes: data.slotDurationMinutes,
      capacity: data.capacity ?? 1,
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
}

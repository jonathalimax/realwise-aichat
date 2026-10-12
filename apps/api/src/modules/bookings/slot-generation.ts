// Pure slot generation for visit scheduling, extracted from AvailabilityService.computeSlots so
// it can be unit-tested without a database. Semantics are unchanged from the original inline
// implementation: recurring weekday rules expanded day by day in the business timezone, blackout
// dates skipped, a 2h lead time enforced, and slots already at capacity removed.

// Brazil has not observed DST since 2019, so every IANA zone we care about today is a fixed
// UTC offset. If a business ever needs a non-BR timezone, add it here rather than reaching for a
// full tz database dependency just for this.
const FIXED_OFFSET_MINUTES: Record<string, number> = {
  "America/Sao_Paulo": -180,
  "America/Manaus": -240,
  "America/Rio_Branco": -300,
  "America/Noronha": -120,
};

export function offsetMinutesFor(timezone: string): number {
  return FIXED_OFFSET_MINUTES[timezone] ?? -180;
}

// Builds a UTC Date representing `hour:minute` on the given calendar day *in* `timezone`,
// without ever touching server-local time.
export function zonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const offsetMin = offsetMinutesFor(timezone);
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - offsetMin * 60000);
}

export function dateKeyInZone(date: Date, timezone: string): { year: number; month: number; day: number; weekday: number } {
  const offsetMin = offsetMinutesFor(timezone);
  const shifted = new Date(date.getTime() + offsetMin * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

export const MAX_RANGE_DAYS = 14;
export const MAX_SLOTS = 60;
export const LEAD_TIME_MS = 2 * 60 * 60 * 1000;

export interface SlotRule {
  kind: string;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  slotDurationMinutes: number;
  capacity: number;
  isBlocked: boolean;
  listingId: string | null;
  exceptionDate: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface SlotCandidate {
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}

// Picks which recurring rules apply: listing-specific rules win when a listing is given and has
// any; otherwise the business-wide (listingId null) rules.
export function selectActiveRules(rules: SlotRule[], listingId?: string | null): SlotRule[] {
  const recurring = rules.filter((r) => r.kind === "recurring" && !r.isBlocked);
  if (listingId) {
    const specific = recurring.filter((r) => r.listingId === listingId);
    return specific.length > 0 ? specific : recurring.filter((r) => r.listingId === null);
  }
  return recurring.filter((r) => r.listingId === null);
}

export function blackoutDateKeys(rules: SlotRule[]): Set<string> {
  return new Set(rules.filter((r) => r.isBlocked && r.exceptionDate).map((r) => r.exceptionDate!.toISOString().slice(0, 10)));
}

export function generateSlotCandidates(
  rules: SlotRule[],
  params: { from: Date; to: Date; timezone: string; listingId?: string | null; now?: Date },
): SlotCandidate[] {
  const activeRules = selectActiveRules(rules, params.listingId);
  const blackoutDates = blackoutDateKeys(rules);
  const cappedTo = new Date(Math.min(params.to.getTime(), params.from.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000));
  const now = params.now ?? new Date();
  const leadCutoff = new Date(now.getTime() + LEAD_TIME_MS);
  const candidates: SlotCandidate[] = [];

  for (let i = 0; i < MAX_RANGE_DAYS; i += 1) {
    const probe = new Date(params.from.getTime() + i * 24 * 60 * 60 * 1000);
    if (probe > cappedTo) break;
    const { year, month, day, weekday } = dateKeyInZone(probe, params.timezone);
    const dayKey = zonedDateTime(year, month, day, 0, 0, params.timezone).toISOString().slice(0, 10);
    if (blackoutDates.has(dayKey)) continue;

    for (const rule of activeRules) {
      if (rule.weekday !== weekday) continue;
      if (!rule.startTime || !rule.endTime) continue;
      if (rule.validFrom && probe < rule.validFrom) continue;
      if (rule.validUntil && probe > rule.validUntil) continue;

      const [startH, startM] = rule.startTime.split(":").map(Number);
      const [endH, endM] = rule.endTime.split(":").map(Number);
      let cursor = zonedDateTime(year, month, day, startH, startM, params.timezone);
      const dayEnd = zonedDateTime(year, month, day, endH, endM, params.timezone);

      while (cursor.getTime() + rule.slotDurationMinutes * 60000 <= dayEnd.getTime()) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(cursor.getTime() + rule.slotDurationMinutes * 60000);
        if (slotStart >= leadCutoff) candidates.push({ startsAt: slotStart, endsAt: slotEnd, capacity: rule.capacity });
        cursor = slotEnd;
      }
    }
  }
  return candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function filterOpenSlots(
  candidates: SlotCandidate[],
  appointments: { startsAt: Date; endsAt: Date }[],
  maxSlots = MAX_SLOTS,
): { startsAt: string; endsAt: string }[] {
  const open: { startsAt: string; endsAt: string }[] = [];
  for (const candidate of candidates) {
    const booked = appointments.filter(
      (a) => a.startsAt.getTime() < candidate.endsAt.getTime() && a.endsAt.getTime() > candidate.startsAt.getTime(),
    ).length;
    if (booked >= candidate.capacity) continue;
    open.push({ startsAt: candidate.startsAt.toISOString(), endsAt: candidate.endsAt.toISOString() });
    if (open.length >= maxSlots) break;
  }
  return open;
}

// Property visits are configured as "Visita ao local" in the dashboard, but older businesses only
// configured the default "Presencial" type — use whichever the business actually set up.
export function resolveVisitAppointmentType(configuredTypes: Iterable<string>): "visita_local" | "presencial" {
  const types = new Set(configuredTypes);
  if (types.has("visita_local")) return "visita_local";
  return "presencial";
}

export interface ScheduleDay {
  dateKey: string;
  label: string;
  weekday: string;
  slots: { startsAt: string; endsAt: string; label: string }[];
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Groups open slots by calendar day IN THE BUSINESS TIMEZONE (not the visitor's browser zone), so
// the day bubbles only ever show days the business actually attends.
export function groupSlotsByDay(
  slots: { startsAt: string; endsAt: string }[],
  timezone: string,
  options: { maxDays?: number; maxSlotsPerDay?: number } = {},
): ScheduleDay[] {
  const maxDays = options.maxDays ?? 7;
  const maxSlotsPerDay = options.maxSlotsPerDay ?? 16;
  const days = new Map<string, ScheduleDay>();
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const start = new Date(slot.startsAt);
    const { year, month, day, weekday } = dateKeyInZone(start, timezone);
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let entry = days.get(dateKey);
    if (!entry) {
      if (days.size >= maxDays) continue;
      entry = {
        dateKey,
        label: `${WEEKDAY_SHORT[weekday]}, ${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}`,
        weekday: WEEKDAY_SHORT[weekday],
        slots: [],
      };
      days.set(dateKey, entry);
    }
    if (entry.slots.length >= maxSlotsPerDay) continue;
    const local = new Date(start.getTime() + offsetMinutesFor(timezone) * 60000);
    const label = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
    entry.slots.push({ startsAt: slot.startsAt, endsAt: slot.endsAt, label });
  }
  return [...days.values()];
}

export const MAX_VISIT_OPTIONS = 3;

// Validates the visitor's chosen date+time options against what was actually offered: dedupes,
// keeps only offered slots, sorts chronologically, caps at MAX_VISIT_OPTIONS. The first (earliest)
// becomes the appointment; the rest are recorded as alternatives for the team.
export function resolveVisitSelection(
  chosen: { startsAt: string; endsAt: string }[],
  offered: { startsAt: string; endsAt: string }[],
): { primary: { startsAt: string; endsAt: string }; alternatives: { startsAt: string; endsAt: string }[] } | null {
  const offeredKeys = new Set(offered.map((s) => `${new Date(s.startsAt).toISOString()}|${new Date(s.endsAt).toISOString()}`));
  const seen = new Set<string>();
  const valid: { startsAt: string; endsAt: string }[] = [];
  for (const slot of chosen) {
    const start = new Date(slot.startsAt);
    const end = new Date(slot.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const key = `${start.toISOString()}|${end.toISOString()}`;
    if (seen.has(key) || !offeredKeys.has(key)) continue;
    seen.add(key);
    valid.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
  }
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const capped = valid.slice(0, MAX_VISIT_OPTIONS);
  return { primary: capped[0], alternatives: capped.slice(1) };
}

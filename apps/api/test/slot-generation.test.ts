import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterOpenSlots,
  generateSlotCandidates,
  groupSlotsByDay,
  resolveVisitAppointmentType,
  resolveVisitSelection,
  type SlotRule,
} from "../src/modules/bookings/slot-generation";

const TZ = "America/Sao_Paulo";

function rule(weekday: number, startTime: string, endTime: string, overrides: Partial<SlotRule> = {}): SlotRule {
  return {
    kind: "recurring",
    weekday,
    startTime,
    endTime,
    slotDurationMinutes: 60,
    capacity: 1,
    isBlocked: false,
    listingId: null,
    exceptionDate: null,
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

// Monday 2026-10-12 08:00 in São Paulo (11:00Z).
const from = new Date("2026-10-12T11:00:00.000Z");
const to = new Date("2026-10-18T11:00:00.000Z"); // Sunday
const now = new Date("2026-10-12T03:00:00.000Z");

test("only days the business attends produce slots (Mon-Sat example)", () => {
  const rules = [1, 2, 3, 4, 5, 6].map((d) => rule(d, "09:00", "12:00"));
  const candidates = generateSlotCandidates(rules, { from, to, timezone: TZ, now });
  const days = groupSlotsByDay(filterOpenSlots(candidates, []), TZ);
  assert.deepEqual(days.map((d) => d.weekday), ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]);
  assert.deepEqual(days[0].slots.map((s) => s.label), ["09:00", "10:00", "11:00"]);
  assert.equal(days[0].label, "Seg, 12/10");
});

test("lead time, blackout dates and capacity are respected", () => {
  const rules = [rule(1, "09:00", "12:00"), rule(2, "09:00", "11:00", { capacity: 1 }), rule(2, "00:00", "00:00", { kind: "exception", isBlocked: true, weekday: null, exceptionDate: new Date("2026-10-13T00:00:00.000Z") })];
  // "now" = Monday 08:30 local -> 2h lead time (10:30) leaves only the 11:00 slot on Monday.
  const candidates = generateSlotCandidates(rules, { from, to, timezone: TZ, now: new Date("2026-10-12T11:30:00.000Z") });
  const monday = candidates.filter((c) => c.startsAt.toISOString().startsWith("2026-10-12"));
  assert.deepEqual(monday.map((c) => c.startsAt.toISOString()), ["2026-10-12T14:00:00.000Z"]);
  assert.equal(candidates.filter((c) => c.startsAt.toISOString().startsWith("2026-10-13")).length, 0);

  const open = filterOpenSlots(candidates, [{ startsAt: new Date("2026-10-12T14:00:00.000Z"), endsAt: new Date("2026-10-12T15:00:00.000Z") }]);
  assert.equal(open.some((s) => s.startsAt === "2026-10-12T14:00:00.000Z"), false);
});

test("listing-specific rules win over business-wide rules", () => {
  const rules = [rule(1, "09:00", "10:00"), rule(1, "15:00", "16:00", { listingId: "L1" })];
  const forListing = generateSlotCandidates(rules, { from, to, timezone: TZ, now, listingId: "L1" });
  assert.deepEqual(forListing.map((c) => c.startsAt.toISOString()), ["2026-10-12T18:00:00.000Z"]);
  const general = generateSlotCandidates(rules, { from, to, timezone: TZ, now });
  assert.deepEqual(general.map((c) => c.startsAt.toISOString()), ["2026-10-12T12:00:00.000Z"]);
});

test("resolveVisitAppointmentType prefers 'visita_local' when configured", () => {
  assert.equal(resolveVisitAppointmentType(["presencial", "visita_local"]), "visita_local");
  assert.equal(resolveVisitAppointmentType(["presencial"]), "presencial");
  assert.equal(resolveVisitAppointmentType([]), "presencial");
});

test("resolveVisitSelection keeps only offered slots, sorted, max 3", () => {
  const offered = [
    { startsAt: "2026-10-13T12:00:00.000Z", endsAt: "2026-10-13T13:00:00.000Z" },
    { startsAt: "2026-10-12T12:00:00.000Z", endsAt: "2026-10-12T13:00:00.000Z" },
    { startsAt: "2026-10-14T12:00:00.000Z", endsAt: "2026-10-14T13:00:00.000Z" },
    { startsAt: "2026-10-15T12:00:00.000Z", endsAt: "2026-10-15T13:00:00.000Z" },
  ];
  const chosen = [offered[0], offered[1], offered[1], { startsAt: "2026-10-20T12:00:00.000Z", endsAt: "2026-10-20T13:00:00.000Z" }, offered[2], offered[3]];
  const result = resolveVisitSelection(chosen, offered);
  assert.ok(result);
  assert.equal(result!.primary.startsAt, "2026-10-12T12:00:00.000Z");
  assert.deepEqual(result!.alternatives.map((s) => s.startsAt), ["2026-10-13T12:00:00.000Z", "2026-10-14T12:00:00.000Z"]);
  assert.equal(resolveVisitSelection([{ startsAt: "bad", endsAt: "bad" }], offered), null);
});

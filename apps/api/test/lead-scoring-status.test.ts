import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeadScore, temperatureReason, type LeadSignalInputs } from "../src/modules/leads/lead-scoring";
import { isLeadStatus, nextLeadStatus, statusUpdateFields } from "../src/modules/leads/lead-status";

const base: LeadSignalInputs = {
  hasNameAndPhone: false,
  messageCount: 0,
  askedPrice: false,
  askedAvailability: false,
  startedBooking: false,
  completedBooking: false,
  askedLocation: false,
  askedPaymentOrFinancing: false,
  requestedEscalation: false,
  isReturningVisitor: false,
  sentDocument: false,
  askedSpecificItem: false,
  weeksSinceLastActivity: 0,
};

test("a lead with no signals is cold", () => {
  const result = computeLeadScore(base);
  assert.equal(result.band, "cold");
  assert.equal(result.score, 0);
  assert.equal(temperatureReason(result.signals), "Pouca atividade até agora");
});

test("selection + budget + engagement makes a warm lead", () => {
  const result = computeLeadScore({ ...base, selectedListing: true, statedBudget: true, hasNameAndPhone: true, messageCount: 6 });
  assert.equal(result.band, "warm");
  assert.equal(result.signals[0].label, "Selecionou imóvel");
});

test("visit scheduled with selection is hot, and the reason is stored", () => {
  const result = computeLeadScore({ ...base, startedBooking: true, selectedListing: true, hasNameAndPhone: true, messageCount: 6 });
  assert.equal(result.band, "hot");
  assert.match(temperatureReason(result.signals), /^Agendou visita · Selecionou imóvel/);
});

test("inactivity decays the score", () => {
  const fresh = computeLeadScore({ ...base, startedBooking: true, selectedListing: true, hasNameAndPhone: true, messageCount: 6 });
  const stale = computeLeadScore({ ...base, startedBooking: true, selectedListing: true, hasNameAndPhone: true, messageCount: 6, weeksSinceLastActivity: 4 });
  assert.ok(stale.score < fresh.score);
});

test("automatic status transitions only move early stages forward", () => {
  assert.equal(nextLeadStatus("new", "visit_scheduled"), "visit_scheduled");
  assert.equal(nextLeadStatus("contacted", "visit_scheduled"), "visit_scheduled");
  assert.equal(nextLeadStatus("negotiating", "visit_scheduled"), null);
  assert.equal(nextLeadStatus("closed_won", "visit_scheduled"), null);
  assert.equal(nextLeadStatus("new", "owner_contacted"), "contacted");
  assert.equal(nextLeadStatus("visit_scheduled", "owner_contacted"), null);
  assert.equal(nextLeadStatus(undefined, "owner_contacted"), "contacted");
});

test("closing a lead stamps closedAt once and syncs ownerOutcome", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const won = statusUpdateFields({ status: "visit_scheduled" }, "closed_won", now);
  assert.equal(won.closedAt?.toISOString(), now.toISOString());
  assert.equal(won.ownerOutcome, "won");
  const earlier = new Date("2026-10-01T12:00:00Z");
  assert.equal(statusUpdateFields({ status: "closed_won", closedAt: earlier }, "closed_lost", now).closedAt, earlier);
  const reopened = statusUpdateFields({ status: "closed_won", closedAt: earlier }, "negotiating", now);
  assert.equal(reopened.closedAt, null);
  assert.equal(reopened.ownerOutcome, null);
  assert.equal(isLeadStatus("closed_won"), true);
  assert.equal(isLeadStatus("deleted"), false);
});

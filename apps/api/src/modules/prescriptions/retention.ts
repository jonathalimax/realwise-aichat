// Prescription retention + access rules. Pure and unit tested.

import { hasPermission, type PermissionMap } from "@realwise/shared";

/** Safety cap while the order is still open (or the file was never attached to an order). */
export const OPEN_RETENTION_CAP_DAYS = 90;
const DAY = 24 * 3600 * 1000;

/**
 * retentionDeleteAt = max(order closedAt, reviewedAt) + retentionDays once the order is closed
 * (delivered / canceled / rejected). Until then: upload date + 90 days.
 */
export function computeRetentionDeleteAt(input: {
  uploadedAt: Date;
  closedAt?: Date | null;
  reviewedAt?: Date | null;
  retentionDays: number;
}): Date {
  if (!input.closedAt) return new Date(input.uploadedAt.getTime() + OPEN_RETENTION_CAP_DAYS * DAY);
  const base = Math.max(input.closedAt.getTime(), input.reviewedAt?.getTime() ?? 0);
  return new Date(base + input.retentionDays * DAY);
}

export function isPurgeDue(rx: { retentionDeleteAt: Date | null; fileDeletedAt: Date | null }, now = Date.now()): boolean {
  return !rx.fileDeletedAt && !!rx.retentionDeleteAt && rx.retentionDeleteAt.getTime() <= now;
}

export function retentionLabel(rx: { retentionDeleteAt: Date | null; fileDeletedAt: Date | null }): string {
  if (rx.fileDeletedAt) return "Arquivo apagado";
  if (!rx.retentionDeleteAt) return "Sem data de exclusão";
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const d = rx.retentionDeleteAt;
  return `Apagada em ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type RxAccess = "ok" | "not_found" | "purged" | "denied";

/**
 * Who may download a prescription file: an authenticated member of the SAME business with receitas
 * view/edit. A different business gets "not_found" (never reveal existence); a purged file is "purged" (410).
 */
export function evaluateRxAccess(
  member: { businessId: string; permissions: PermissionMap } | null | undefined,
  rx: { businessId: string; fileDeletedAt: Date | null } | null | undefined,
): RxAccess {
  if (!member || !rx) return "not_found";
  if (member.businessId !== rx.businessId) return "not_found";
  if (!hasPermission(member.permissions, "receitas", "view")) return "denied";
  if (rx.fileDeletedAt) return "purged";
  return "ok";
}

/** Brief of a handoff: expired when its retention date has passed. Purge sets brief = {}. */
export function isBriefExpired(h: { retentionDeleteAt: Date | null }, now = Date.now()): boolean {
  return !!h.retentionDeleteAt && h.retentionDeleteAt.getTime() <= now;
}

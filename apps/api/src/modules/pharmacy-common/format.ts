import { maskBrPhone } from "@realwise/shared";

/** 84260 -> "R$ 842,60" (integer cents only, never floats from the DB). */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/** Whole-real display used by chart KPIs when cents are zero: 702000 -> "R$ 7.020". */
export function formatBRLShort(cents: number): string {
  return cents % 100 === 0 ? formatBRL(cents).replace(/,00$/, "") : formatBRL(cents);
}

/** "+5541998123344" -> "(41) 99812-3344" */
export function formatPhoneBr(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return maskBrPhone(national) || phone;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function minutesSince(date: Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - date.getTime()) / 60000));
}

export function parseLimit(raw: unknown, def = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/** Folds accents/case/punctuation so "Dipirona 500MG" and "dipirona 500 mg" match. */
export function fold(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function sliceCursor<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

// Time-zone aware windows and chart buckets for the dashboard summary / analytics. Pure.

export type Range = "today" | "7d" | "30d";

export function parseRange(raw: unknown): Range {
  return raw === "today" || raw === "30d" ? raw : "7d";
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  weekday: number; // 0 = Sunday
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", weekday: "short" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, weekday: wd };
}

/** UTC instant of 00:00 local time of the day containing `date` in `timeZone`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const lp = localParts(date, timeZone);
  const guess = Date.UTC(lp.year, lp.month - 1, lp.day, 0, 0, 0);
  // offset = local wall clock (read as UTC) - real UTC, evaluated at the guess; one refinement covers DST edges.
  const offsetAt = (t: number) => {
    const l = localParts(new Date(t), timeZone);
    const d = new Date(t);
    const wallAsUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, d.getUTCMinutes(), d.getUTCSeconds());
    return wallAsUtc - Math.floor(t / 1000) * 1000;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600 * 1000);
}

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface Window {
  /** Inclusive start (UTC instant). */
  from: Date;
  title: string;
  /** Number of days covered (1 for today). */
  days: number;
}

export function windowFor(range: Range, now: Date, timeZone: string): Window {
  const today = startOfLocalDay(now, timeZone);
  switch (range) {
    case "today":
      return { from: today, title: "Hoje", days: 1 };
    case "7d":
      return { from: addDays(today, -6), title: "Últimos 7 dias", days: 7 };
    case "30d":
      return { from: addDays(today, -29), title: "Últimos 30 dias", days: 30 };
  }
}

export interface BucketDef {
  label: string;
  /** Maps an instant to this bucket index or -1. */
  index(date: Date): number;
}

/** today: 7 two-hour buckets "8h".."20h"; 7d: weekday labels; 30d: "S1".."S5" (5 blocks of 6 days, S5 = latest). */
export function bucketLabels(range: Range, now: Date, timeZone: string): string[] {
  if (range === "today") return ["8h", "10h", "12h", "14h", "16h", "18h", "20h"];
  if (range === "30d") return ["S1", "S2", "S3", "S4", "S5"];
  const today = startOfLocalDay(now, timeZone);
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[localParts(addDays(today, i - 6 + 0.5), timeZone).weekday]);
}

export function bucketIndex(range: Range, date: Date, now: Date, timeZone: string): number {
  const w = windowFor(range, now, timeZone);
  if (date.getTime() < w.from.getTime() || date.getTime() > now.getTime() + 1000) return -1;
  if (range === "today") {
    const h = localParts(date, timeZone).hour;
    return Math.min(6, Math.max(0, Math.floor((h - 8) / 2)));
  }
  const dayIndex = Math.floor((startOfLocalDay(date, timeZone).getTime() - w.from.getTime()) / (24 * 3600 * 1000) + 0.5);
  if (range === "7d") return Math.min(6, Math.max(0, dayIndex));
  return Math.min(4, Math.max(0, Math.floor(dayIndex / 6)));
}

export function deltaNote(today: number, yesterday: number): string {
  const d = today - yesterday;
  if (d === 0) return "igual a ontem";
  return `${d > 0 ? "+" : ""}${d} em relação a ontem`;
}

/** "João Silva" -> "João S." */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

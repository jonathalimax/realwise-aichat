import type { Job } from "bullmq";
import { postInternalApi } from "../internal-api";

// Scheduled pharmacy jobs (docs/pharmacy/API.md 11). BullMQ queue names cannot contain ":", so
// `pharmacy:order-reminders` is the queue `pharmacy-order-reminders`, and so on.
export const PHARMACY_JOBS = [
  { queue: "pharmacy-order-reminders", path: "/internal/pharmacy/order-reminders", cron: "* * * * *" }, // every minute
  { queue: "pharmacy-stale-sheet", path: "/internal/pharmacy/stale-sheet", cron: "0 * * * *" }, // hourly
  { queue: "pharmacy-retention-purge", path: "/internal/pharmacy/retention-purge", cron: "30 3 * * *" }, // daily
] as const;

export function pharmacyJobProcessor(path: string) {
  return async (_job: Job) => {
    const result = await postInternalApi(path, 5 * 60_000);
    // Counts only: results never contain health data.
    console.log(`[pharmacy-job] ${path}`, JSON.stringify(result));
  };
}

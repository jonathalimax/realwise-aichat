import type { Job } from "bullmq";
import { postInternalApi } from "../internal-api";

// Queue `catalog-import` (docs/pharmacy/API.md 11). The heavy lifting (parse, ONE model call with ~20
// sample rows, deterministic apply) lives in the API, next to the Prisma models and the pure import
// logic; the worker only gives it a durable, retried, one-at-a-time trigger.
//   job "map":   POST /internal/businesses/:businessId/catalog-imports/:id/map
//   job "apply": POST /internal/businesses/:businessId/catalog-imports/:id/apply   (big files only)
export interface CatalogImportJobData {
  businessId: string;
  importId: string;
}

export async function processCatalogImport(job: Job<CatalogImportJobData>) {
  const { businessId, importId } = job.data;
  if (job.name !== "map" && job.name !== "apply") throw new Error(`unknown catalog-import job: ${job.name}`);
  // Both endpoints are idempotent and record failures on the CatalogImport row themselves.
  await postInternalApi(`/internal/businesses/${businessId}/catalog-imports/${importId}/${job.name}`);
}

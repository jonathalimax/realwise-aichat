import { Job } from "bullmq";
import { callInternalApi } from "../internal-api";

export interface ListingExtractionJobData {
  businessId: string;
}

export async function processListingExtraction(job: Job<ListingExtractionJobData>) {
  const { businessId } = job.data;
  await callInternalApi("/listings/extract", businessId);
}

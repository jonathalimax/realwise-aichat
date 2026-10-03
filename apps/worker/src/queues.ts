import { Queue } from "bullmq";
import { redisConnection } from "./redis";

// Shared queue handle so processors can enqueue follow-up jobs without importing index.ts
// (which would create a circular dependency).
export const listingExtractionQueue = new Queue("listing-extraction", {
  connection: redisConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
});

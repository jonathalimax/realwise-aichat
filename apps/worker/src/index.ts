import { Worker, Queue } from "bullmq";
import { prisma } from "@realwise/db";
import { redisConnection } from "./redis";
import { processDocumentIngestion } from "./processors/document-ingestion";
import { processWebsiteSync } from "./processors/website-sync";
import { processTrialWatch } from "./processors/trial-watch";
import { processColdLeadDigest } from "./processors/cold-lead-digest";

const documentWorker = new Worker("document-ingestion", processDocumentIngestion, {
  connection: redisConnection,
  concurrency: 2,
});
documentWorker.on("completed", (job) => console.log(`document-ingestion ${job.id} completed`));
documentWorker.on("failed", (job, err) => console.error(`document-ingestion ${job?.id} failed`, err));

const websiteSyncQueue = new Queue("website-sync", { connection: redisConnection });
const websiteSyncWorker = new Worker("website-sync", processWebsiteSync, {
  connection: redisConnection,
  concurrency: 2,
});
websiteSyncWorker.on("completed", (job) => console.log(`website-sync ${job.id} completed`));
websiteSyncWorker.on("failed", (job, err) => console.error(`website-sync ${job?.id} failed`, err));

const scheduleQueue = new Queue("website-sync-schedule", { connection: redisConnection });
const scheduleWorker = new Worker(
  "website-sync-schedule",
  async () => {
    const businesses = await prisma.business.findMany({
      where: {
        websiteUrl: { not: null },
        status: { in: ["live", "pending_review"] },
        subscription: { plan: { code: "studio" } },
      },
      select: { id: true },
    });
    for (const business of businesses) {
      await websiteSyncQueue.add("sync", { businessId: business.id }, { removeOnComplete: true, removeOnFail: 50 });
    }
    console.log(`website-sync-schedule enqueued ${businesses.length} studio-plan business(es)`);
  },
  { connection: redisConnection },
);
scheduleWorker.on("failed", (job, err) => console.error(`website-sync-schedule ${job?.id} failed`, err));

const trialWatchQueue = new Queue("trial-watch", { connection: redisConnection });
const trialWatchWorker = new Worker("trial-watch", processTrialWatch, { connection: redisConnection });
trialWatchWorker.on("completed", (job) => console.log(`trial-watch ${job.id} completed`));
trialWatchWorker.on("failed", (job, err) => console.error(`trial-watch ${job?.id} failed`, err));

const coldLeadDigestQueue = new Queue("cold-lead-digest", { connection: redisConnection });
const coldLeadDigestWorker = new Worker("cold-lead-digest", processColdLeadDigest, { connection: redisConnection });
coldLeadDigestWorker.on("completed", (job) => console.log(`cold-lead-digest ${job.id} completed`));
coldLeadDigestWorker.on("failed", (job, err) => console.error(`cold-lead-digest ${job?.id} failed`, err));

async function main() {
  await scheduleQueue.add(
    "weekly-scan",
    {},
    { repeat: { pattern: "0 4 * * 1" }, jobId: "weekly-scan", removeOnComplete: true, removeOnFail: 10 },
  );
  await trialWatchQueue.add(
    "daily-check",
    {},
    { repeat: { pattern: "0 9 * * *" }, jobId: "daily-check", removeOnComplete: true, removeOnFail: 10 },
  );
  await coldLeadDigestQueue.add(
    "daily-digest",
    {},
    { repeat: { pattern: "0 10 * * *" }, jobId: "daily-digest", removeOnComplete: true, removeOnFail: 10 },
  );
  console.log("Realwise worker running — listening on queues: document-ingestion, website-sync, website-sync-schedule, trial-watch, cold-lead-digest");
}

main();

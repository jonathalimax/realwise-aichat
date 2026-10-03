import { Worker, Queue } from "bullmq";
import { prisma } from "@realwise/db";
import { redisConnection } from "./redis";
import { processDocumentIngestion } from "./processors/document-ingestion";
import { processWebsiteSync } from "./processors/website-sync";
import { processTrialWatch } from "./processors/trial-watch";
import { processColdLeadDigest } from "./processors/cold-lead-digest";
import { processListingExtraction } from "./processors/listing-extraction";
import { listingExtractionQueue } from "./queues";

const documentWorker = new Worker("document-ingestion", processDocumentIngestion, {
  connection: redisConnection,
  concurrency: 2,
});
documentWorker.on("completed", (job) => console.log(`document-ingestion ${job.id} completed`));
documentWorker.on("failed", (job, err) => console.error(`document-ingestion ${job?.id} failed`, err));

const defaultJobOptions = { attempts: 3, backoff: { type: "exponential" as const, delay: 10_000 } };

const websiteSyncQueue = new Queue("website-sync", { connection: redisConnection, defaultJobOptions });
const websiteSyncWorker = new Worker("website-sync", processWebsiteSync, {
  connection: redisConnection,
  concurrency: 2,
});
websiteSyncWorker.on("completed", (job) => console.log(`website-sync ${job.id} completed`));
websiteSyncWorker.on("failed", (job, err) => {
  const isFinalAttempt = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1);
  console.error(`website-sync ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 1})`, err);
  if (isFinalAttempt) console.error(`website-sync ${job?.id}: exhausted retries, treating as a real incident`);
});

// Enqueues website-sync jobs for every business on one of `planCodes`, on the given cron cadence.
function makeScheduleWorker(queueName: string, planCodes: string[]) {
  const queue = new Queue(queueName, { connection: redisConnection, defaultJobOptions });
  const worker = new Worker(
    queueName,
    async () => {
      const businesses = await prisma.business.findMany({
        where: {
          websiteUrl: { not: null },
          status: { in: ["live", "pending_review"] },
          subscription: { plan: { code: { in: planCodes } } },
        },
        select: { id: true },
      });
      for (const business of businesses) {
        await websiteSyncQueue.add("sync", { businessId: business.id }, { removeOnComplete: true, removeOnFail: 50 });
      }
      console.log(`${queueName} enqueued ${businesses.length} business(es) on plan(s) ${planCodes.join(", ")}`);
    },
    { connection: redisConnection },
  );
  worker.on("failed", (job, err) => {
    const isFinalAttempt = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1);
    console.error(`${queueName} ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 1})`, err);
    if (isFinalAttempt) console.error(`${queueName} ${job?.id}: exhausted retries, treating as a real incident`);
  });
  return { queue, worker };
}

// Weekly: essencial + studio plans. Daily: profissional plans (previously got zero automated sync).
const { queue: scheduleQueue } = makeScheduleWorker("website-sync-schedule", ["essencial", "studio"]);
const { queue: scheduleQueueDaily } = makeScheduleWorker("website-sync-schedule-daily", ["profissional"]);

const listingExtractionWorker = new Worker("listing-extraction", processListingExtraction, { connection: redisConnection });
listingExtractionWorker.on("completed", (job) => console.log(`listing-extraction ${job.id} completed`));
listingExtractionWorker.on("failed", (job, err) => console.error(`listing-extraction ${job?.id} failed`, err));

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
  await scheduleQueueDaily.add(
    "daily-scan",
    {},
    { repeat: { pattern: "0 4 * * *" }, jobId: "daily-scan", removeOnComplete: true, removeOnFail: 10 },
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
  console.log("Realwise worker running — listening on queues: document-ingestion, website-sync, website-sync-schedule, website-sync-schedule-daily, listing-extraction, trial-watch, cold-lead-digest");
}

main();

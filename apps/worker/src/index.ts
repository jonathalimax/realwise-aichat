import { Worker, Queue } from "bullmq";
import { prisma } from "@realwise/db";
import { redisConnection } from "./redis";
import { processDocumentIngestion } from "./processors/document-ingestion";
import { processWebsiteSync } from "./processors/website-sync";
import { processTrialWatch } from "./processors/trial-watch";
import { processColdLeadDigest } from "./processors/cold-lead-digest";
import { processListingExtraction } from "./processors/listing-extraction";
import { processBcbRateSync } from "./processors/bcb-rate-sync";
import { processSharedKnowledgeIngestion } from "./processors/shared-knowledge-ingestion";
import { processConversationRetentionPurge } from "./processors/conversation-retention-purge";
import { listingExtractionQueue } from "./queues";

// concurrency:1 — embedding generation is CPU-bound against a single-instance Ollama on a small
// VPS; two documents embedding simultaneously forces requests to queue inside Ollama itself,
// pushing real (sequential) compute time past even a generous per-request timeout.
const documentWorker = new Worker("document-ingestion", processDocumentIngestion, {
  connection: redisConnection,
  concurrency: 1,
});
documentWorker.on("completed", (job) => console.log(`document-ingestion ${job.id} completed`));
documentWorker.on("failed", (job, err) => console.error(`document-ingestion ${job?.id} failed`, err));

const defaultJobOptions = { attempts: 3, backoff: { type: "exponential" as const, delay: 10_000 } };

const websiteSyncQueue = new Queue("website-sync", { connection: redisConnection, defaultJobOptions });
const websiteSyncWorker = new Worker("website-sync", processWebsiteSync, {
  connection: redisConnection,
  concurrency: 1,
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

const bcbRateSyncQueue = new Queue("bcb-rate-sync", { connection: redisConnection });
const bcbRateSyncWorker = new Worker("bcb-rate-sync", processBcbRateSync, { connection: redisConnection });
bcbRateSyncWorker.on("completed", (job) => console.log(`bcb-rate-sync ${job.id} completed`));
bcbRateSyncWorker.on("failed", (job, err) => console.error(`bcb-rate-sync ${job?.id} failed`, err));

// Same embedding-CPU-bound reasoning as documentWorker above — one at a time.
const sharedKnowledgeWorker = new Worker("shared-knowledge-ingestion", processSharedKnowledgeIngestion, {
  connection: redisConnection,
  concurrency: 1,
});
sharedKnowledgeWorker.on("completed", (job) => console.log(`shared-knowledge-ingestion ${job.id} completed`));
sharedKnowledgeWorker.on("failed", (job, err) => console.error(`shared-knowledge-ingestion ${job?.id} failed`, err));

// LGPD retention enforcement (docs/legal/politica-de-privacidade.md §4). Weekly cadence is
// sufficient — a 12-month retention window has no need for daily precision, and this keeps DB
// load for a delete-heavy job off the busier daily slots already used by other jobs.
const conversationRetentionPurgeQueue = new Queue("conversation-retention-purge", { connection: redisConnection });
const conversationRetentionPurgeWorker = new Worker(
  "conversation-retention-purge",
  processConversationRetentionPurge,
  { connection: redisConnection },
);
conversationRetentionPurgeWorker.on("completed", (job) => console.log(`conversation-retention-purge ${job.id} completed`));
conversationRetentionPurgeWorker.on("failed", (job, err) => console.error(`conversation-retention-purge ${job?.id} failed`, err));

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
  await bcbRateSyncQueue.add(
    "weekly-sync",
    {},
    { repeat: { pattern: "0 5 * * 1" }, jobId: "weekly-sync", removeOnComplete: true, removeOnFail: 10 },
  );
  await conversationRetentionPurgeQueue.add(
    "weekly-purge",
    {},
    { repeat: { pattern: "0 3 * * 0" }, jobId: "weekly-purge", removeOnComplete: true, removeOnFail: 10 },
  );
  console.log("Realwise worker running — listening on queues: document-ingestion, website-sync, website-sync-schedule, website-sync-schedule-daily, listing-extraction, trial-watch, cold-lead-digest, bcb-rate-sync, shared-knowledge-ingestion, conversation-retention-purge");
}

main();

import { Worker } from "bullmq";
import { redisConnection } from "./redis";
import { processDocumentIngestion } from "./processors/document-ingestion";

const documentWorker = new Worker("document-ingestion", processDocumentIngestion, {
  connection: redisConnection,
  concurrency: 2,
});

documentWorker.on("completed", (job) => console.log(`document-ingestion ${job.id} completed`));
documentWorker.on("failed", (job, err) => console.error(`document-ingestion ${job?.id} failed`, err));

console.log("Realwise worker running — listening on queue: document-ingestion");

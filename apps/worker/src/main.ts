import { Worker } from "bullmq";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

const worker = new Worker(
  "realwise-events",
  async (job) => {
    console.log(JSON.stringify({ event: "job_processed", name: job.name, id: job.id }));
  },
  { connection },
);

worker.on("failed", (job, error) => {
  console.error(JSON.stringify({ event: "job_failed", name: job?.name, id: job?.id, error: error.message }));
});

console.log(JSON.stringify({ event: "worker_started", queue: "realwise-events" }));

import { Queue, type JobsOptions } from "bullmq";

export const MESSAGE_PROCESSING_QUEUE = "realwise-message-processing";

export type ProcessMessageJob = {
  tenantId: string;
  messageId: string;
  conversationId: string;
  externalEventId: string;
};

export function createRedisConnection(redisUrl: string) {
  return { url: redisUrl };
}

export function createMessageProcessingQueue(redisUrl: string) {
  return new Queue<ProcessMessageJob>(MESSAGE_PROCESSING_QUEUE, { connection: createRedisConnection(redisUrl) });
}

export function messageJobId(input: Pick<ProcessMessageJob, "tenantId" | "externalEventId">) {
  return `${input.tenantId}__${input.externalEventId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { CatalogImportJobs } from "./catalog-import.service";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

/** BullMQ queue `catalog-import` (jobs `map` and `apply`), consumed by apps/worker. */
@Injectable()
export class BullCatalogImportJobs implements CatalogImportJobs {
  private readonly queue = new Queue("catalog-import", { connection });

  async enqueue(kind: "map" | "apply", businessId: string, importId: string): Promise<void> {
    await this.queue.add(kind, { businessId, importId }, { attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: 50 });
  }
}

import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

@Injectable()
export class DocumentIngestionQueue {
  private readonly queue = new Queue("document-ingestion", { connection });

  async enqueue(documentId: string, localPath: string) {
    await this.queue.add("ingest", { documentId, localPath });
  }
}

import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { DocumentIngestionQueue } from "../../queues/document-ingestion.queue";

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, DocumentIngestionQueue],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}

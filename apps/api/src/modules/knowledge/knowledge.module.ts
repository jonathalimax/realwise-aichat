import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeQaService } from "./knowledge-qa.service";
import { DocumentIngestionQueue } from "../../queues/document-ingestion.queue";

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeQaService, DocumentIngestionQueue],
  exports: [KnowledgeService, KnowledgeQaService],
})
export class KnowledgeModule {}

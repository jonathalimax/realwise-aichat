import { Module } from "@nestjs/common";
import { SharedKnowledgeController } from "./shared-knowledge.controller";
import { SharedKnowledgeService } from "./shared-knowledge.service";
import { SharedKnowledgeIngestionQueue } from "../../queues/shared-knowledge-ingestion.queue";

@Module({
  controllers: [SharedKnowledgeController],
  providers: [SharedKnowledgeService, SharedKnowledgeIngestionQueue],
  exports: [SharedKnowledgeService],
})
export class SharedKnowledgeModule {}

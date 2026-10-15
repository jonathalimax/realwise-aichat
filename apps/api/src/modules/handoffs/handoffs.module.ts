import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { PushModule } from "../push/push.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { HandoffsController } from "./handoffs.controller";
import { HandoffsService } from "./handoffs.service";

@Module({
  imports: [ChatModule, PushModule, KnowledgeModule],
  controllers: [HandoffsController],
  providers: [HandoffsService],
  exports: [HandoffsService],
})
export class HandoffsModule {}

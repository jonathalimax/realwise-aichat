import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { PushModule } from "../push/push.module";
import { HandoffsController } from "./handoffs.controller";
import { HandoffsService } from "./handoffs.service";

@Module({
  imports: [ChatModule, PushModule],
  controllers: [HandoffsController],
  providers: [HandoffsService],
  exports: [HandoffsService],
})
export class HandoffsModule {}

import { Module } from "@nestjs/common";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [ChatModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}

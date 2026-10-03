import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { PushModule } from "../push/push.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [PushModule, ChatModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}

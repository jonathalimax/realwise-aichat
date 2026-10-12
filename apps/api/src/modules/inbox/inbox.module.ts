import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { PushModule } from "../push/push.module";
import { ChatModule } from "../chat/chat.module";
import { ListingsModule } from "../listings/listings.module";

@Module({
  imports: [PushModule, ChatModule, ListingsModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}

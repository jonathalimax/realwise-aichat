import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { FlowService } from "./flow.service";
import { BookingsModule } from "../bookings/bookings.module";

@Module({
  imports: [BookingsModule],
  controllers: [ChatController],
  providers: [ChatService, FlowService],
  exports: [ChatService],
})
export class ChatModule {}

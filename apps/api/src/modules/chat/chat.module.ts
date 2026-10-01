import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { BookingsModule } from "../bookings/bookings.module";

@Module({
  imports: [BookingsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}

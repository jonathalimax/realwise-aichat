import { Body, Controller, Post } from "@nestjs/common";
import { mockMetaEventSchema, normalizeMockMetaEvent } from "@realwise/meta";
import { MessagingService } from "./messaging.service";

@Controller("webhooks/meta")
export class MetaWebhookController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post("mock")
  async acceptMockEvent(@Body() body: unknown) {
    const event = mockMetaEventSchema.parse(body);
    const message = normalizeMockMetaEvent(event);
    const result = await this.messagingService.acceptNormalizedMessage(message, body);
    return {
      releaseState: "MOCK_VERIFIED",
      normalized: message,
      ...result,
    };
  }
}

import { Body, Controller, Post } from "@nestjs/common";
import { fakeAssistantDecision } from "@realwise/knowledge";
import { mockMetaEventSchema, normalizeMockMetaEvent } from "@realwise/meta";

@Controller("webhooks/meta")
export class MetaWebhookController {
  @Post("mock")
  acceptMockEvent(@Body() body: unknown) {
    const event = mockMetaEventSchema.parse(body);
    const message = normalizeMockMetaEvent(event);
    const decision = fakeAssistantDecision(message, [{ id: "source-prices", title: "Planos e preços" }], { humanActive: false, aiEnabled: true });
    return {
      accepted: true,
      releaseState: "MOCK_VERIFIED",
      normalized: message,
      assistantDecision: decision,
    };
  }
}

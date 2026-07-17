import { Body, Controller, Get, Post } from "@nestjs/common";
import { chunkKnowledge } from "@realwise/knowledge";

@Controller("knowledge")
export class KnowledgeController {
  @Get("sources")
  sources() {
    return [
      { id: "source-hours", tenantId: "demo-academia", title: "Horários de atendimento", kind: "BUSINESS_PROFILE", releaseState: "MOCK_VERIFIED", updatedAt: new Date().toISOString() },
      { id: "source-prices", tenantId: "demo-academia", title: "Planos e preços", kind: "FAQ", releaseState: "MOCK_VERIFIED", updatedAt: new Date().toISOString() },
    ];
  }

  @Post("preview-chunks")
  previewChunks(@Body() body: { text?: string }) {
    return { chunks: chunkKnowledge(body.text ?? "") };
  }
}

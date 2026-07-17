import { Controller, Get } from "@nestjs/common";
import type { DashboardSummary } from "@realwise/contracts";

@Controller("dashboard")
export class DashboardController {
  @Get("summary")
  summary(): DashboardSummary {
    return {
      tenant: {
        id: "demo-academia",
        name: "Academia Realwise Demo",
        segment: "Academia e artes marciais",
        aiEnabled: true,
        releaseState: "MOCK_VERIFIED",
      },
      health: {
        channelsConnected: 3,
        channelsWithActionRequired: 1,
        humansWaiting: 2,
        aiPausedConversations: 1,
      },
      usage: {
        messagesUsed: 384,
        messagesLimit: 1000,
        knowledgeSources: 7,
      },
      nextActions: [
        "Conectar credenciais reais da Meta para sair do modo mock.",
        "Revisar preços e horários aprovados da academia.",
        "Responder 2 conversas aguardando humano no Chatwoot.",
      ],
    };
  }
}

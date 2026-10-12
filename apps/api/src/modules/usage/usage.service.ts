import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  // A conversation counts toward the plan quota only once a model actually answered in it
  // (llmTurns > 0). chat.service only increments llmTurns for model-generated replies, so sessions
  // served purely by the fixed flow (hours, address, menus), the scripted greeting, canned
  // no-context replies or gateway-failure fallbacks don't count — the definition promised on the
  // pricing pages (PRICING_COPY.conversationDefinition).
  async countConversationsThisMonth(businessId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.prisma.client.conversation.count({
      where: { businessId, startedAt: { gte: startOfMonth }, llmTurns: { gt: 0 } },
    });
  }

  // Subscribed plan's code + quota; null for a business with no subscription yet (trial), which
  // callers treat as the entry tier (getEntryPlan()).
  async getSubscriptionPlan(businessId: string): Promise<{ code: string; conversationQuota: number } | null> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { businessId },
      select: { plan: { select: { code: true, conversationQuota: true } } },
    });
    return subscription?.plan ?? null;
  }
}
